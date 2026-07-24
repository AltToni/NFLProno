# Scripts d'exploitation

Deux scripts, cote hote, pour la sauvegarde et la restauration de la base.

## Pourquoi `sqlite3 .backup` et pas `cp`

La base tourne en mode WAL : les ecritures recentes vivent dans `nfl.db-wal`
avant d'etre repliees dans `nfl.db`. Un `cp` du seul fichier `.db` capture donc
un etat incomplet, et un `cp` des trois fichiers pendant une ecriture capture un
etat incoherent. `.backup` passe par l'API de sauvegarde de SQLite, qui produit
un instantane coherent sans arreter l'application.

## Deux mecanismes de sauvegarde, volontairement

| | Ecrit dans | Retention | Declencheur |
|---|---|---|---|
| Cron interne de l'application | `backup/nfl-*.db` | `BACKUP_KEEP` (14) | 04:30, croner |
| `scripts/backup.sh` | `backup/nocturne/nflprono-*.db.gz` | `KEEP_DAYS` (30) | 03:30, systemd |

Ils n'ecrivent pas au meme endroit et ne se purgent pas mutuellement : la
rotation interne ne regarde que `nfl-*.db`, celle du script que
`nflprono-*.db.gz`. Si l'un des deux casse, l'autre continue.

Seul `backup.sh` sort les donnees de la machine (`REMOTE_TARGET`). C'est lui
qui protege d'une panne disque ; le cron interne ne protege que d'une betise
applicative.

## Installation

```bash
sudo cp scripts/systemd/nflprono-backup.* /etc/systemd/system/
sudo $EDITOR /etc/systemd/system/nflprono-backup.service   # REMOTE_TARGET
sudo systemctl daemon-reload
sudo systemctl enable --now nflprono-backup.timer

systemctl list-timers nflprono-backup.timer
sudo systemctl start nflprono-backup.service   # essai immediat
journalctl -u nflprono-backup -n 40
```

Le service tourne en **root** : il compresse et purge des fichiers appartenant
a uid 1000 (l'utilisateur du conteneur) et pilote Docker.

## Destination distante

`REMOTE_TARGET` accepte deux formes :

```bash
REMOTE_TARGET=nas:/volume1/pronos      # rsync over ssh, cle sans passphrase
REMOTE_TARGET=/mnt/nas/pronos          # chemin local : montage SMB ou NFS deja monte
```

Pour un partage SMB, monter d'abord cote hote (`/etc/fstab`, `cifs-utils`) puis
pointer `REMOTE_TARGET` sur le point de montage. Le script ne monte rien
lui-meme : un montage qui tombe doit faire echouer la sauvegarde bruyamment,
pas etre remonte en silence par un script de sauvegarde.

## Restauration

```bash
scripts/restore.sh --latest              # derniere sauvegarde, avec confirmation
scripts/restore.sh backup/nocturne/nflprono-20260910-043000.db.gz
scripts/restore.sh --latest --yes        # sans confirmation
```

Le script, dans cet ordre :

1. decompresse la sauvegarde dans un repertoire temporaire ;
2. verifie `PRAGMA integrity_check` **avant de toucher a quoi que ce soit** et
   affiche le nombre de joueurs et de pronostics qu'elle contient ;
3. met la base actuelle de cote dans `backup/avant-restauration-*.db` ;
4. arrete le conteneur ;
5. supprime `nfl.db`, `nfl.db-wal` et `nfl.db-shm` puis depose la sauvegarde —
   **oublier le WAL est le piege classique** : SQLite rejouerait par-dessus la
   base restauree un journal qui ne lui correspond pas ;
6. redemarre et attend l'etat `healthy`.

Si l'integrite est mauvaise, il s'arrete avant l'etape 3 : la base en place
n'est jamais detruite au profit d'une sauvegarde illisible.

## Verifier que ca marche

Le round-trip sauvegarde -> modification -> restauration est teste a chaque
push par le job `sauvegarde` du workflow `Image Docker`. Une restauration reelle
sur la machine de production reste a faire une fois avant le coup d'envoi.
