#!/usr/bin/env bash
#
# Sauvegarde nocturne de la base SQLite, cote hote.
#
# Utilise `sqlite3 .backup` et non une copie de fichier : `.backup` passe par
# l'API de sauvegarde de SQLite, qui produit un instantane coherent meme si
# l'application ecrit pendant l'operation. Un `cp` sur une base en mode WAL
# peut capturer un fichier a moitie ecrit, sans le WAL qui va avec.
#
# Ce script est independant du cron interne de l'application (qui fait un
# VACUUM INTO vers /backup avec sa propre retention). Les deux coexistent
# volontairement : si l'un casse, l'autre reste. Ils n'ecrivent pas au meme
# endroit et ne se purgent pas mutuellement.
#
#   application  ->  backup/nfl-<horodatage>.db          retention BACKUP_KEEP
#   ce script    ->  backup/nocturne/nflprono-*.db.gz    retention KEEP_DAYS
#
# Usage :
#   scripts/backup.sh
#   KEEP_DAYS=60 REMOTE_TARGET=nas:/volume1/pronos scripts/backup.sh
#
# Variables :
#   CONTAINER      nom du conteneur           (defaut : nfl-pronos)
#   BACKUP_ROOT    repertoire hote            (defaut : <repo>/backup)
#   KEEP_DAYS      retention locale en jours  (defaut : 30)
#   REMOTE_TARGET  destination rsync. Deux formes :
#                    hote:/chemin   -> rsync over ssh
#                    /chemin        -> copie locale (utile pour un montage SMB
#                                      ou NFS deja monte sur l'hote)
#                  vide = pas de copie distante.
#   RSYNC_OPTS     options supplementaires    (defaut : -a --delete-after)

set -euo pipefail

CONTAINER="${CONTAINER:-nfl-pronos}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backup}"
DEST_DIR="$BACKUP_ROOT/nocturne"
KEEP_DAYS="${KEEP_DAYS:-30}"
REMOTE_TARGET="${REMOTE_TARGET:-}"
RSYNC_OPTS="${RSYNC_OPTS:--a --delete-after}"

# Chemins vus depuis l'interieur du conteneur.
DB_IN_CONTAINER="${DB_IN_CONTAINER:-/data/nfl.db}"
BACKUP_IN_CONTAINER="${BACKUP_IN_CONTAINER:-/backup}"

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }
die() { printf '[%s] ERREUR: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

# --- Verrou : une sauvegarde a la fois -------------------------------------
# Sans ca, une execution manuelle pendant le cron produirait deux `.backup`
# concurrents sur la meme base.
LOCK="${TMPDIR:-/tmp}/nflprono-backup.lock"
if command -v flock > /dev/null 2>&1; then
	exec 9> "$LOCK"
	flock -n 9 || die "une sauvegarde est deja en cours ($LOCK)"
fi

# --- Verifications ----------------------------------------------------------
command -v docker > /dev/null 2>&1 || die "docker introuvable"

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
	|| die "le conteneur $CONTAINER ne tourne pas"

# Le repertoire est cree DEPUIS le conteneur, pour qu'il appartienne a uid 1000
# et que le `.backup` puisse y ecrire. S'il etait cree par l'hote en root, le
# conteneur ne pourrait pas s'en servir.
docker exec "$CONTAINER" mkdir -p "$BACKUP_IN_CONTAINER/nocturne" \
	|| die "impossible de creer $BACKUP_IN_CONTAINER/nocturne dans le conteneur"

[ -d "$DEST_DIR" ] || die "$DEST_DIR invisible depuis l'hote : le montage ./backup est-il en place ?"

# Ce script compresse et purge cote hote : il lui faut le droit d'ecrire dans
# un repertoire qui appartient a uid 1000. En pratique, il tourne en root
# (cron systeme ou unite systemd) — cf. l'exemple en fin de fichier.
[ -w "$DEST_DIR" ] || die "$DEST_DIR non inscriptible par $(id -un) — lancer ce script en root"

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="nflprono-$STAMP.db"
TMP_IN_CONTAINER="$BACKUP_IN_CONTAINER/nocturne/$NAME"
LOCAL_FILE="$DEST_DIR/$NAME"

# --- Sauvegarde -------------------------------------------------------------
log "sauvegarde de $DB_IN_CONTAINER vers $NAME"
docker exec "$CONTAINER" sqlite3 "$DB_IN_CONTAINER" ".backup '$TMP_IN_CONTAINER'" \
	|| die "echec du .backup sqlite3"

[ -s "$LOCAL_FILE" ] || die "$LOCAL_FILE absent ou vide apres le .backup"

# --- Controle d'integrite ---------------------------------------------------
# Une sauvegarde jamais relue est une sauvegarde dont on ignore la valeur.
log "controle d'integrite"
RESULT="$(docker exec "$CONTAINER" sqlite3 "$TMP_IN_CONTAINER" 'PRAGMA integrity_check;' | head -1)"
[ "$RESULT" = "ok" ] || die "integrity_check a repondu « $RESULT »"

TABLES="$(docker exec "$CONTAINER" sqlite3 "$TMP_IN_CONTAINER" \
	"select count(*) from sqlite_master where type='table';")"
[ "$TABLES" -ge 10 ] || die "seulement $TABLES table(s) dans la sauvegarde, attendu >= 10"

log "integrite ok, $TABLES tables"

# --- Compression ------------------------------------------------------------
gzip -9 -f "$LOCAL_FILE"
LOCAL_FILE="$LOCAL_FILE.gz"
SIZE="$(du -h "$LOCAL_FILE" | cut -f1)"
log "compresse : $(basename "$LOCAL_FILE") ($SIZE)"

# --- Rotation ---------------------------------------------------------------
PRUNED=0
while IFS= read -r old; do
	rm -f "$old"
	PRUNED=$((PRUNED + 1))
done < <(find "$DEST_DIR" -maxdepth 1 -name 'nflprono-*.db.gz' -type f -mtime "+$KEEP_DAYS")
log "rotation : $PRUNED fichier(s) de plus de $KEEP_DAYS jours supprime(s)"

REMAINING="$(find "$DEST_DIR" -maxdepth 1 -name 'nflprono-*.db.gz' -type f | wc -l)"
log "$REMAINING sauvegarde(s) locale(s) conservee(s)"

# --- Copie distante ---------------------------------------------------------
# Une sauvegarde sur le meme disque que la base ne protege de rien : ni d'une
# panne disque, ni d'un rm -rf. C'est cette etape qui fait le travail.
if [ -n "$REMOTE_TARGET" ]; then
	command -v rsync > /dev/null 2>&1 || die "rsync introuvable, requis pour REMOTE_TARGET"
	log "copie vers $REMOTE_TARGET"
	# shellcheck disable=SC2086
	rsync $RSYNC_OPTS "$DEST_DIR/" "$REMOTE_TARGET/" || die "echec de la copie distante"
	log "copie distante terminee"
else
	log "REMOTE_TARGET vide : pas de copie hors machine (a configurer avant la saison)"
fi

log "termine : $LOCAL_FILE"
