#!/usr/bin/env bash
#
# Restauration de la base SQLite depuis une sauvegarde.
#
# Ordre des operations, volontairement paranoiaque : on verifie l'integrite de
# la sauvegarde AVANT de toucher a quoi que ce soit, et on met la base actuelle
# de cote avant de l'ecraser. Une restauration qui detruit la seule copie
# saine ne vaut rien.
#
# Usage :
#   scripts/restore.sh --latest
#   scripts/restore.sh backup/nocturne/nflprono-20260910-043000.db.gz
#   scripts/restore.sh --latest --yes        # sans confirmation (cron, CI)
#
# Variables : CONTAINER, BACKUP_ROOT (memes valeurs que backup.sh)

set -euo pipefail

CONTAINER="${CONTAINER:-nfl-pronos}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backup}"
DEST_DIR="$BACKUP_ROOT/nocturne"

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }
die() { printf '[%s] ERREUR: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

SOURCE=""
ASSUME_YES=0
for arg in "$@"; do
	case "$arg" in
		--latest)
			SOURCE="$(find "$DEST_DIR" -maxdepth 1 -name 'nflprono-*.db.gz' -type f 2>/dev/null \
				| sort | tail -1)"
			[ -n "$SOURCE" ] || die "aucune sauvegarde dans $DEST_DIR"
			;;
		--yes | -y) ASSUME_YES=1 ;;
		-*) die "option inconnue : $arg" ;;
		*) SOURCE="$arg" ;;
	esac
done

[ -n "$SOURCE" ] || die "usage : $0 (--latest | <fichier>) [--yes]"
[ -f "$SOURCE" ] || die "fichier introuvable : $SOURCE"

command -v docker > /dev/null 2>&1 || die "docker introuvable"

# --- Ou vit la base ---------------------------------------------------------
# Le volume est nomme par le projet compose : on le lit sur le conteneur plutot
# que de le deviner.
VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' \
	"$CONTAINER" 2>/dev/null || true)"
[ -n "$VOLUME" ] || die "volume /data introuvable sur le conteneur $CONTAINER"

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
log "conteneur $CONTAINER | volume $VOLUME | image $IMAGE"

# --- Preparation de la source ----------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CANDIDATE="$WORK/restauration.db"

case "$SOURCE" in
	*.gz)
		log "decompression de $(basename "$SOURCE")"
		gunzip -c "$SOURCE" > "$CANDIDATE"
		;;
	*) cp "$SOURCE" "$CANDIDATE" ;;
esac

[ -s "$CANDIDATE" ] || die "la sauvegarde est vide apres decompression"

# --- Verification avant toute destruction -----------------------------------
log "controle d'integrite de la sauvegarde"
RESULT="$(docker run --rm -v "$WORK:/x" "$IMAGE" \
	sqlite3 /x/restauration.db 'PRAGMA integrity_check;' | head -1)"
[ "$RESULT" = "ok" ] || die "sauvegarde corrompue : integrity_check a repondu « $RESULT »"

USERS="$(docker run --rm -v "$WORK:/x" "$IMAGE" sqlite3 /x/restauration.db \
	'select count(*) from users;' 2>/dev/null || echo '?')"
PICKS="$(docker run --rm -v "$WORK:/x" "$IMAGE" sqlite3 /x/restauration.db \
	'select count(*) from picks;' 2>/dev/null || echo '?')"
log "integrite ok — $USERS joueur(s), $PICKS pronostic(s) dans cette sauvegarde"

# --- Confirmation -----------------------------------------------------------
if [ "$ASSUME_YES" -ne 1 ]; then
	printf 'Remplacer la base de %s par %s ? [oui/N] ' "$CONTAINER" "$(basename "$SOURCE")"
	read -r reponse
	[ "$reponse" = "oui" ] || die "annule"
fi

# --- Mise de cote de la base actuelle ---------------------------------------
STAMP="$(date +%Y%m%d-%H%M%S)"
SAFETY="$BACKUP_ROOT/avant-restauration-$STAMP.db"
mkdir -p "$BACKUP_ROOT"

if docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
	log "copie de securite de la base actuelle"
	docker exec "$CONTAINER" sqlite3 /data/nfl.db ".backup '/backup/avant-restauration-$STAMP.db'" \
		&& log "base actuelle sauvegardee dans $(basename "$SAFETY")" \
		|| log "AVERTISSEMENT : copie de securite impossible, on continue"
fi

# --- Remplacement -----------------------------------------------------------
log "arret du conteneur"
docker stop "$CONTAINER" > /dev/null

# Les fichiers -wal et -shm doivent disparaitre avec la base : laisses en
# place, SQLite rejouerait par-dessus la base restauree un journal qui ne lui
# correspond pas. C'est le piege classique de la restauration en mode WAL.
log "remplacement de la base dans le volume $VOLUME"
docker run --rm -v "$VOLUME:/data" -v "$WORK:/x" "$IMAGE" sh -c '
	set -e
	rm -f /data/nfl.db /data/nfl.db-wal /data/nfl.db-shm
	cp /x/restauration.db /data/nfl.db
	chown 1000:1000 /data/nfl.db
	chmod 644 /data/nfl.db
'

log "redemarrage"
docker start "$CONTAINER" > /dev/null

# --- Attente de l'etat healthy ----------------------------------------------
for i in $(seq 1 30); do
	ETAT="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo absent)"
	[ "$ETAT" = healthy ] && { log "conteneur healthy apres $((i * 2)) s"; break; }
	[ "$ETAT" = unhealthy ] && die "le conteneur est unhealthy apres restauration"
	sleep 2
done
[ "$ETAT" = healthy ] || die "le conteneur n'est pas devenu healthy (etat : $ETAT)"

APRES="$(docker exec "$CONTAINER" sqlite3 /data/nfl.db 'select count(*) from users;')"
log "termine — $APRES joueur(s) en base"
log "copie de la base precedente : $SAFETY"
