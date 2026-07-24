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

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f app     # le magic link initial y apparait si SMTP absent
```

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

Le cron quotidien ecrit une copie coherente dans `BACKUP_DIR`. Monter ce
repertoire sur un **second disque** ou un partage distant :

```yaml
volumes:
  - /mnt/disque2/pronos-backup:/backup
```

Restauration : arreter le conteneur, remplacer `/data/nfl.db` par le fichier de
sauvegarde, redemarrer.

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
