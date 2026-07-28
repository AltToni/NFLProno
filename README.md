# Pronos NFL — saison 2026

Jeu de pronostics NFL auto-héberge pour un groupe prive (10 à 25 joueurs).
Interface en francais, points inversement proportionnels à la probabilite de
victoire, barème fige une fois par semaine.

- **Stack** : SvelteKit (adapter-node) + TypeScript, SQLite + Drizzle, croner,
  nodemailer. Un seul conteneur, un seul fichier `.db`.
- **Source de donnees** : API publique ESPN (calendrier, scores, moneylines).
- **Auth** : code d'invitation + magic link. Aucun mot de passe.

---

## 1. Demarrage rapide

### En local

```bash
npm install
cp .env.example .env        # renseigner au minimum AUTH_SECRET et ADMIN_EMAIL
npm run dev
```

Sans `SMTP_HOST`, les magic links sont ecrits dans la console : il suffit de
copier l'URL affichee pour se connecter.

Le compte defini par `ADMIN_EMAIL` est cree en administrateur au premier
demarrage. C'est lui qui emet les premieres invitations depuis `/admin`.

### Avec Docker

Build local (`docker-compose.yml`) :

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f app     # le magic link initial y apparait si SMTP absent
```

En production, on ne construit pas : on tire l'image publiee par la CI. Voir
la section 6.

L'application ecoute sur `127.0.0.1:3000` ; la base vit dans le volume
`db-data`, les sauvegardes dans `./backup`.

---

## 2. Variables d'environnement

| Variable | Role |
|---|---|
| `PUBLIC_BASE_URL` | URL publique, utilisee pour construire les magic links |
| `AUTH_SECRET` | ≥ 32 caracteres. **Obligatoire en production**, sert au HMAC des jetons |
| `TZ` | Fuseau des crons — `Europe/Brussels` |
| `DATABASE_PATH` | Chemin du fichier SQLite (`/data/nfl.db` en conteneur) |
| `BACKUP_DIR`, `BACKUP_KEEP` | Destination et retention des sauvegardes quotidiennes |
| `SEASON_YEAR` | Saison à interroger chez ESPN (2026) |
| `SMTP_*` | Serveur d'envoi des magic links. Vide = logs |
| `ADMIN_EMAIL`, `ADMIN_PSEUDO` | Compte admin cree au premier demarrage |
| `CRON_*` | Surcharge des planifications ; `CRON_ENABLED=0` desactive l'ordonnanceur |

Generer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 3. Cycle hebdomadaire

Tout tourne dans le process Node (croner), fuseau `Europe/Brussels`.

| Tache | Planification | Effet |
|---|---|---|
| `snapshot` | mercredi 09:00 | Recupere le calendrier + les cotes, **fige le barème**, ouvre les pronostics |
| `results` | toutes les 15 min, jeu → lun | Rafraichit statuts et scores, calcule les points des matchs `final` |
| `close` | mardi 09:00 | Clot les semaines entierement jouees, designe le vainqueur hebdo |
| `backup` | 04:30 tous les jours | `VACUUM INTO` vers `BACKUP_DIR`, rotation sur `BACKUP_KEEP` |
| `reminder` | jeudi 08:00 | Email « tu n'as pas encore pronostique » (desactive par defaut) |

Chaque execution est journalisee dans `cron_runs` et visible dans `/admin`,
avec relance manuelle possible.

**Le verrouillage n'est pas une tache planifiee** : il est calcule à la volee à
partir de `games.kickoff_utc`, et verifie cote serveur à chaque enregistrement
de pronostic. Un match se verrouille donc exactement à son kickoff, sans
dependre d'un cron.

---

## 4. Barème

### Probabilite implicite

Moneylines americaines du snapshot → probabilites brutes :

```
ml < 0 :  p_raw = -ml / (-ml + 100)
ml > 0 :  p_raw = 100 / (ml + 100)
```

puis de-vig par normalisation : `p = p_raw / (p_raw_home + p_raw_away)`.

### Points

```
base  = clamp(round(25 / p), 25, 250)
```

| Resultat | Points |
|---|---|
| Vainqueur correct | `base` |
| + ecart exact | `base × 1,5` |
| + score exact | `base × 2` (remplace le bonus d'ecart) |
| Vainqueur incorrect | 0 |
| Match nul | `base × 0,5` de l'equipe choisie |
| Match nul predit (ecart 0) | `base × 1,5` |
| Match reporte / annule | 0 pour tous, match neutralise |
| Cotes absentes au snapshot | `p = 0,5` des deux cotes, signale dans l'admin |
| Pas de pronostic | 0 |

Playoffs (option desactivee par defaut) : Wild Card ×1,5, Divisional ×2,
Championships ×2,5, Super Bowl ×3.

Toutes ces constantes sont en base (`settings`) et editables dans `/admin`.

**Deux points d'interpretation de la spec**, à trancher avant le coup d'envoi :

1. *Match nul avec score exact predit.* La spec prevoit « points de base +
   bonus d'ecart » pour qui predit un nul. L'implementation applique la regle
   generale du §2.3 : si le score du nul est exact au point pres, c'est le bonus
   de score exact (×2) qui s'applique, sinon le bonus d'ecart (×1,5). Pour
   coller au texte à la lettre, mettre `scoring.exact_bonus_pct` = 0,5.
2. *Coherence score / vainqueur.* Un pronostic dont le score donnerait la
   victoire à l'equipe non choisie est refuse (cote client **et** serveur). Le
   nul reste autorise quelle que soit l'equipe choisie, puisque la spec le
   prevoit explicitement.

Le module `src/lib/scoring.ts` est pur (ni base ni reseau) et couvert par
`npm test`.

---

## 5. Architecture

```
src/
  lib/
    scoring.ts            barème (pur, teste)
    nfl.ts, time.ts       libelles, formats belges, fuseaux
    types.ts              types partages serveur / composants
    components/           GameCard, RankChart, Countdown, LocalTime
    server/
      db/                 schema Drizzle + migrations idempotentes
      espn.ts             client ESPN (retries, double source de cotes)
      sync.ts             snapshot hebdo + poll des scores
      results.ts          calcul des points (idempotent)
      standings.ts        classements, evolution des rangs, stats joueur
      picks.ts            lecture/ecriture des pronostics, verrouillage
      auth.ts, mail.ts    invitations, magic links, sessions, SMTP
      cron.ts, backup.ts  ordonnanceur et sauvegardes
  routes/
    connexion/            code d'invitation + magic link
    pronostics/           grille de la semaine
    match/[id]/           pronostics du groupe + points
    classement/           general, hebdo, graphe d'evolution
    joueur/[id]/          historique et statistiques
    admin/                invitations, taches, reglages, corrections
```

### Choix notables

- **Migrations sans CLI.** `src/lib/server/db/migrate.ts` joue des scripts SQL
  numerotes suivis par `PRAGMA user_version`. Le conteneur se suffit à lui-meme,
  aucune etape `drizzle-kit push` au deploiement. `drizzle.config.ts` reste
  fourni pour `npm run db:studio`.
- **Double source de cotes.** ESPN retire `odds[]` du scoreboard des qu'un match
  est termine, et parfois plusieurs jours avant le kickoff. Le snapshot complete
  donc chaque match sans moneyline via
  `sports.core.api.espn.com/.../competitions/{id}/odds`, et ne bascule sur le
  repli 50/50 qu'en dernier recours.
- **Barème reellement fige.** `odds_snapshots` a une ligne par match, jamais
  reecrite — sauf case « ecraser » de l'admin. Le JSON brut ESPN est conserve
  dans `raw_json` pour audit.
- **Recalcul idempotent.** `computeGameScores` supprime puis reecrit les lignes
  `scores` du match à partir des pronostics et du barème fige. Le relancer
  autant de fois qu'on veut donne le meme resultat.
- **Corrections manuelles protegees.** Un score corrige dans `/admin/matchs`
  positionne `manual_override` : le poll ESPN ne l'ecrase plus jusqu'à ce qu'un
  admin retablisse la synchronisation.
- **Confidentialite des pronostics.** `gameDetail()` renvoie une liste vide tant
  que le kickoff n'est pas passe : rien à masquer cote client, les donnees ne
  quittent pas le serveur.
- **Graphe d'evolution.** Avec 25 joueurs, une couleur par courbe serait
  illisible et indistinguable en vision des couleurs deficiente. Toutes les
  courbes sont donc neutres, seule celle du joueur connecte (ou survolee) est
  mise en avant, avec etiquette directe ; le tableau au-dessus donne la vue
  chiffree.

---

## 6. Deploiement

### Image et mise en route

Chaque push sur `main` publie l'image sur GHCR apres passage des tests
(`.github/workflows/image.yml`). Deux tags : `latest`, et `sha-<commit>` qui est
immuable — **c'est celui qu'il faut epingler pendant la saison**, `latest`
bougeant au prochain push.

```bash
docker login ghcr.io -u AltToni          # PAT avec le scope read:packages
cp .env.example .env && $EDITOR .env
mkdir -p backup && sudo chown 1000:1000 backup   # le conteneur ecrit en uid 1000
docker compose -f docker-compose.prod.yml up -d
```

Mise a jour :

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Le compose derive `ORIGIN` de `PUBLIC_BASE_URL` et refuse de demarrer si elle
manque. Ce n'est pas cosmetique : sans `ORIGIN`, adapter-node reconstitue
l'origine en `http://` depuis l'en-tete `Host` du reverse proxy, la
verification CSRF echoue et **tous les formulaires renvoient 403**.

### Deploiement continu

Le job `deployer` de `image.yml` prend la suite du `docker compose pull` fait a
la main : connexion SSH au VPS, tirage de l'image, redemarrage du compose, puis
le meme POST de connexion que le test de fumee mais **contre l'URL publique** —
seule facon de verifier que le reverse proxy et `ORIGIN` s'accordent.

Il ne part que sur un push sur `main` ou un declenchement manuel, et seulement
apres les tests, la fumee et l'aller-retour de sauvegarde : une image cassee
n'atteint pas plus la production que le registre.

#### Une fois, sur le VPS

```bash
# 1. Repertoire cible. Il doit contenir docker-compose.prod.yml et .env,
#    deposes par git clone ou scp (le depot est prive : pas de curl anonyme).
sudo mkdir -p /opt/nfl-pronos && sudo chown "$USER" /opt/nfl-pronos
cd /opt/nfl-pronos
mkdir -p backup && sudo chown 1000:1000 backup

# 2. L'utilisateur SSH doit pouvoir parler a Docker sans sudo.
sudo usermod -aG docker "$USER"     # puis se reconnecter
```

Depuis ta machine :

```bash
# 3. Cle dediee au deploiement, sans passphrase.
ssh-keygen -t ed25519 -f ~/.ssh/nflprono-deploy -C "github-actions" -N ""
ssh-copy-id -i ~/.ssh/nflprono-deploy.pub deploy@le.vps.eu

# 4. Empreinte du serveur, a coller telle quelle dans VPS_KNOWN_HOSTS.
ssh-keyscan -p 22 le.vps.eu
```

#### Secrets et variables du depot

_Settings → Secrets and variables → Actions._

| Secret | Contenu |
|---|---|
| `VPS_HOST` | nom d'hote ou IP |
| `VPS_USER` | utilisateur SSH, membre du groupe `docker` |
| `VPS_SSH_KEY` | **cle privee** `~/.ssh/nflprono-deploy`, en entier, en-tetes `BEGIN`/`END` compris |
| `VPS_KNOWN_HOSTS` | sortie de `ssh-keyscan` (etape 4). Facultatif, voir ci-dessous |

| Variable | Defaut | Role |
|---|---|---|
| `PUBLIC_BASE_URL` | — | **obligatoire**, sans slash final |
| `VPS_APP_DIR` | `/opt/nfl-pronos` | repertoire contenant le compose et le `.env` |
| `VPS_PORT` | `22` | port SSH |

`PUBLIC_BASE_URL` est une variable et non un secret : elle est publique par
nature, et la voir dans les logs aide au diagnostic. Le job s'arrete des le
premier pas si une entree obligatoire manque, en nommant celle qui manque —
mieux vaut ca qu'une connexion SSH qui echoue trois etapes plus loin.

**Sans `VPS_KNOWN_HOSTS`**, le job accepte l'empreinte qui se presente et le
signale par un avertissement. Le deploiement marche, mais un intermediaire
pourrait se faire passer pour le VPS et recuperer le contenu de la session.
Le renseigner ferme cette porte.

Le job declare l'environnement `production` : GitHub le cree tout seul au
premier run, et il devient possible d'y exiger une approbation manuelle
(_Settings → Environments → production → Required reviewers_).

#### Ce que le job fait, et ne fait pas

- **Il epingle `sha-<commit>`**, jamais `latest` : entre le build et le
  deploiement, un autre push a pu deplacer `latest`. Le tag est ecrit dans le
  `.env` du VPS pour qu'un `docker compose up -d` lance a la main plus tard
  reparte sur la meme image. Le `.env` precedent est conserve en
  `.env.avant-deploiement`.
- **Il verifie apres coup** que le conteneur tourne bien sur le tag attendu :
  un `pull` qui n'a rien fait passerait sinon inapercu.
- **Il ne touche pas au `docker login` du VPS.** Il se connecte a GHCR dans un
  `DOCKER_CONFIG` jetable : ecraser `~/.docker/config.json` avec le jeton du
  job, qui expire a la fin du run, casserait les `docker compose pull` manuels.
- **Il ne fait pas de retour arriere automatique.** Si le test public echoue,
  la nouvelle version reste en place et le recapitulatif du run affiche la
  commande a passer :

  ```bash
  cd /opt/nfl-pronos
  cp .env.avant-deploiement .env
  docker compose -f docker-compose.prod.yml up -d
  ```

### Derriere un reverse proxy (serveur maison)

`Caddyfile` :

```
pronos.mondomaine.eu {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy gere le certificat TLS automatiquement. Cote UDR7, rediriger 80/443 vers
la machine hote — ou, pour ne rien exposer, utiliser un Cloudflare Tunnel :

```bash
cloudflared tunnel run --url http://127.0.0.1:3000 pronos
```

Dans les deux cas, `PUBLIC_BASE_URL` doit correspondre à l'URL publique, sans
quoi les magic links pointeront au mauvais endroit.

### VPS EU

Hetzner CX22 ou Scaleway DEV1-S (~4 €/mois) suffisent largement : la charge est
de 25 utilisateurs et d'un appel ESPN toutes les 15 minutes.

### Sauvegardes

Deux mecanismes independants, decrits en detail dans `scripts/README.md` :

| | Ecrit dans | Retention | Sort de la machine |
|---|---|---|---|
| Cron interne (`VACUUM INTO`) | `backup/nfl-*.db` | `BACKUP_KEEP` (14) | non |
| `scripts/backup.sh` (`sqlite3 .backup`) | `backup/nocturne/*.db.gz` | `KEEP_DAYS` (30) | oui, via `REMOTE_TARGET` |

Seul le second protege d'une panne disque. Installation du timer :

```bash
sudo cp scripts/systemd/nflprono-backup.* /etc/systemd/system/
sudo $EDITOR /etc/systemd/system/nflprono-backup.service   # renseigner REMOTE_TARGET
sudo systemctl enable --now nflprono-backup.timer
```

Restauration — **ne pas copier le fichier a la main** : `nfl.db-wal` et
`nfl.db-shm` doivent disparaitre avec la base, sinon SQLite rejoue par-dessus
un journal qui ne lui correspond plus.

```bash
scripts/restore.sh --latest
```

Le script verifie l'integrite de la sauvegarde avant de toucher a quoi que ce
soit et met la base courante de cote. L'aller-retour est teste a chaque push.

### Securite

- CSP, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`,
  `Permissions-Policy`, et HSTS des que `PUBLIC_BASE_URL` est en `https://`.
- Limitation de debit sur les magic links (3 par email et 10 par IP par quart
  d'heure) et sur l'echange de codes d'invitation (10 par IP et par heure).
  Compteurs **en memoire** : ils repartent de zero a chaque redemarrage, ce qui
  est acceptable pour ce qu'ils protegent, et serait a revoir si l'application
  passait a plusieurs instances.
- Logs JSON en production (`LOG_FORMAT=texte` pour forcer le format lisible).
  Le journal des requetes n'enregistre pas la chaine de requete :
  `/connexion/verifier` porte le jeton de connexion dans l'URL.

### Etat du systeme

`/admin` ouvre sur une carte « Etat du systeme » : dernier snapshot de cotes,
dernier poll de scores, derniere sauvegarde, echecs de taches non rattrapes.
Les seuils sont contextuels — hors saison, l'absence de snapshot n'est pas
signalee.

`/api/health` sert la sonde de vivacite (200/503, c'est ce que suit Docker) et,
pour un admin connecte uniquement, le detail de ces indicateurs. La fraicheur
ne change jamais le code HTTP : sinon le conteneur redemarrerait en boucle
chaque intersaison.

---

## 7. Exploitation courante

| Besoin | Ou |
|---|---|
| Inviter un joueur | `/admin` → Invitations → « Creer un code » |
| Relancer un snapshot | `/admin` → Actions manuelles (numero de semaine optionnel) |
| Corriger un score | `/admin/matchs` |
| Recalculer tous les points | `/admin` → « Recalculer tous les points » |
| Changer une constante du barème | `/admin` → Reglages, puis recalcul |
| Voir l'etat des crons | `/admin` → Taches planifiees + Journal |
| Redeployer sans pousser de code | Actions → « Image Docker » → Run workflow |
| Revenir a la version precedente | cf. section 6, `.env.avant-deploiement` |

Avant le coup d'envoi de la saison : figer les reglages du barème, lancer un
snapshot de test sur la semaine 1, verifier les enjeux affiches, puis remettre
les pronostics à zero si besoin.

---

## 8. Tests

```bash
npm test          # barème + parsing ESPN
npm run check     # svelte-check / TypeScript
```

Les tests couvrent les exemples chiffres de la spec (p = 0,80 → 31 pts,
0,50 → 50, 0,35 → 71, 0,20 → 125, ≤ 0,10 → 250), le de-vig, les bonus, le match
nul, les multiplicateurs de playoffs, l'idempotence, et la tolerance du client
ESPN aux reponses incompletes.

---

## 9. Hors perimetre v1

Pas de spread ni de props, pas d'application native (PWA installable), pas de
notifications push. Le rappel email du jeudi existe mais est desactive par
defaut (`mail.reminder_enabled`).
