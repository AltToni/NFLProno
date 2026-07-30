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
| `MOCK_ESPN` | `1` active le mode simulation (section 7). Absente en production |

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

### Deux modes de saisie

Pour chaque match, le joueur choisit **comment** il pronostique. La bascule est
sur la carte du match, et le mode retenu est memorise avec le pronostic : deux
matchs de la meme semaine peuvent etre saisis differemment.

| Mode | Ce qu'on saisit | Bonus accessibles |
|---|---|---|
| **A — Vainqueur + ecart** | une equipe et un ecart entier ≥ 1, ou « Match nul » (ecart 0, aucune equipe) | ×1,5 (ecart exact). **Jamais ×2** : aucun score n'est predit |
| **B — Score** | les deux scores ; l'interface derive et affiche en direct le vainqueur et l'ecart | ×1,5 (ecart exact) et ×2 (score exact) |

Les deux modes partagent le meme calcul : l'**ecart signe predit** est la seule
grandeur qui compte, et elle vient soit de l'ecart annonce, soit de la
difference des scores. Le mode ne change donc que l'acces au ×2.

Une carte de `/pronostics`, ici en mode A apres avoir choisi KC et un ecart de
7 points :

```
 19:00                                        dans 2 j 4 h · details

   [ Vainqueur + ecart ]   [        Score       ]   <- bascule par match

     LV  125 pts      @      KC  31 pts             <- choix en vert

   [ Match nul ]   ecart de [ 7 ]  points

   Soit KC +7 — ×1,5 si l'ecart est exact, jamais de ×2.
```

En mode B, la ligne « ecart de » cede la place aux deux cases de score, et la
ligne d'apercu suit la frappe : `Soit KC +7 — ×1,5 si l'ecart est exact, ×2 si
le score l'est`. Le vainqueur y est **derive** du score, il n'y a donc plus de
contradiction possible entre les deux ; le refus des scores incoherents reste en
place cote serveur. Un score nul (`20–20`) est le seul cas ou le joueur designe
encore une equipe à la main : elle decide des points si le match ne finit
finalement pas nul.

Sur `/match/<id>`, les pronostics du groupe sont affiches **sous la forme
saisie** — « KC +7 » ou « 27–20 », avec l'ecart derive en dessous pour un score
predit : on voit ce que chacun a joue, et comment.

### Points

```
base  = clamp(round(25 / p), 25, 250)
```

| Resultat | Points |
|---|---|
| Vainqueur correct | `base` |
| + ecart exact | `base × 1,5` |
| + score exact (mode B uniquement) | `base × 2` (remplace le bonus d'ecart) |
| Vainqueur incorrect | 0 |
| Match nul | `base × 0,5` de l'equipe choisie |
| Match nul predit (ecart 0) | `base × 1,5` |
| Nul predit en mode A, match avec vainqueur | 0 : aucune equipe a crediter |
| Match reporte / annule | 0 pour tous, match neutralise |
| Cotes absentes au snapshot | `p = 0,5` des deux cotes, signale dans l'admin |
| Pas de pronostic | 0 |

Playoffs (option desactivee par defaut) : Wild Card ×1,5, Divisional ×2,
Championships ×2,5, Super Bowl ×3.

Toutes ces constantes sont en base (`settings`) et editables dans `/admin`.

**Exemple chiffre** sur `LV @ KC` — 31 pts sur KC, 125 pts sur LV, resultat final
**KC 24 – LV 20**. Les scores predits se lisent dans l'ordre de l'interface,
**visiteurs–locaux**, soit `LV–KC` :

| Pronostic saisi | Mode | Points |
|---|---|---|
| `KC +4` | A | 47 — vainqueur + ecart exact : `round(31 × 1,5)` |
| `KC +10` | A | 31 — bon vainqueur, ecart rate |
| `LV +4` | A | 0 — mauvais vainqueur |
| `Match nul` | A | 0 — le match a un vainqueur, aucune equipe n'etait designee |
| `20–24` | B | 62 — score exact : `31 × 2` |
| `23–27` | B | 47 — ecart exact (KC +4), score rate |
| `10–30` | B | 31 — bon vainqueur, rien de plus |

Si ce meme match avait fini **20 – 20**, un `Match nul` (mode A) aurait rapporte
`round(78 × 1,5)` = 117 pts, 78 etant la moyenne des deux baremes (voir
interpretation 3 ci-dessous), et un `KC +4` aurait touche `round(31 × 0,5)` =
16 pts au titre du match nul.

**Trois points d'interpretation de la spec**, à trancher avant le coup d'envoi :

1. *Match nul avec score exact predit.* La spec prevoit « points de base +
   bonus d'ecart » pour qui predit un nul. L'implementation applique la regle
   generale du §2.3 : si le score du nul est exact au point pres, c'est le bonus
   de score exact (×2) qui s'applique, sinon le bonus d'ecart (×1,5). Pour
   coller au texte à la lettre, mettre `scoring.exact_bonus_pct` = 0,5. En mode
   A la question ne se pose pas : sans score predit, le bonus reste à ×1,5.
2. *Coherence score / vainqueur.* Un pronostic dont le score donnerait la
   victoire à l'equipe non choisie est refuse (cote client **et** serveur). Le
   nul reste autorise quelle que soit l'equipe choisie, puisque la spec le
   prevoit explicitement. Cote mode A, le controle serveur exige la meme
   coherence : un ecart ≥ 1 designe une equipe, un ecart 0 n'en designe aucune.
3. *Enjeu d'un nul predit en mode A.* « Match nul » ne choisit pas d'equipe,
   donc aucun des deux baremes ne s'impose. Les points en jeu sont la **moyenne
   des deux**, seule valeur neutre. Consequence assumee : si le match a
   finalement un vainqueur, ce pronostic vaut 0, là ou un nul saisi en mode B
   (par exemple `20–20` sur KC) rapporte encore la base de l'equipe choisie.

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
  fourni pour `npm run db:studio`. La v3 reconstruit `picks` (creation, copie,
  `DROP`, `RENAME`, index) : trois colonnes devaient devenir nullables, ce
  qu'`ALTER TABLE` ne sait pas faire en SQLite. `picks` n'etant la table parente
  d'aucune autre, l'operation ne laisse aucune reference pendante.
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
| Rejouer une semaine passee | `/admin` → Outils de test |
| Simuler une semaine en 30 min | `/admin` → Outils de test (`MOCK_ESPN=1`) |
| Effacer les donnees de test | `/admin` → « Supprimer les semaines TEST » |

Avant le coup d'envoi de la saison : figer les reglages du barème, lancer un
snapshot de test sur la semaine 1, verifier les enjeux affiches, puis remettre
les pronostics à zero si besoin.

### Semaines de test

Deux facons d'exercer le cycle complet hors saison, toutes deux depuis
`/admin` → **Outils de test**.

#### Marche a suivre

**Rejeu d'une semaine de 2025** — aucune variable d'environnement, ca marche
sur l'installation courante :

```bash
npm run dev                      # ou l'instance deja en place
```

1. `/admin` → **Outils de test** → Rejeu : annee `2025`, `Saison reguliere`,
   semaine `1` → « Creer la semaine de rejeu ».
   Compter ~2 s et 17 requetes ESPN (1 scoreboard + 1 par match pour les cotes
   historiques). Le message de retour indique le nombre de barèmes figes et,
   le cas echeant, les matchs sans cotes retrouvees.
2. `/pronostics` → onglet **TEST · Rejeu 2025 S1** (en fin de liste) : saisir
   des pronostics, malgre les kickoffs passes et les scores affiches. C'est
   l'occasion d'exercer les deux modes de saisie cote a cote — un « vainqueur +
   ecart », un « Match nul », des scores — et de retrouver les trois formes sur
   `/match/<id>` puis dans le profil joueur.
3. `/admin` → « Recalculer tous les points ».
4. `/classement` → onglet semaine → **TEST · Rejeu 2025 S1** : les points sont
   la. Onglet **General (saison)** : ils n'y sont pas.
5. `/admin` → « Supprimer les semaines TEST ».

**Simulation acceleree** — demande `MOCK_ESPN=1` au demarrage :

```bash
MOCK_ESPN=1 CRON_RESULTS='* * * * *' npm run dev
```

Sur Windows (PowerShell) :

```powershell
$env:MOCK_ESPN = '1'; $env:CRON_RESULTS = '* * * * *'; npm run dev
```

En conteneur, ajouter les deux lignes au `.env` puis `docker compose up -d`.
Sans `CRON_RESULTS`, le poll reste a 15 min : il faut alors cliquer sur
« Relancer » en face de « Poll des scores » pour faire avancer les scores.

1. `/admin` → **Outils de test** → « Creer 4 matchs fictifs ».
   Le bouton n'apparait pas si `MOCK_ESPN` n'est pas a `1`.
2. `/pronostics` → onglet **TEST · Simulation** : pronostiquer les 4 matchs
   dans les 5 minutes.
3. Attendre. A +5 min le premier match se verrouille, son formulaire se ferme
   et `/match/<id>` devient lisible : les pronostics des autres joueurs y
   apparaissent, ce qui demande un second compte pour etre vraiment probant.
4. Les scores avancent d'un quart-temps toutes les 2 min 30. A +15 min le
   premier match est `final` et ses points sont calcules ; a +30 min les quatre
   le sont.
5. `/classement` → onglet semaine, puis `/admin` → « Supprimer les semaines
   TEST ».

#### Ce que fait chaque mode

**Rejeu historique.** Une semaine d'une saison passee (2025) rejouee telle
quelle : vrais matchs, vrais scores, et surtout **vraies cotes de l'epoque**.
ESPN retire `odds[]` du scoreboard des qu'un match est termine, donc les cotes
d'une saison passee viennent toutes du repli sur la core API — qui, elle, les
conserve. Sans ce repli, le barème retomberait sur 50/50 partout et le rejeu ne
testerait plus rien du calcul des points.

Les matchs arrivent deja `final`. Deux consequences assumees, limitees a ces
semaines : le verrouillage au kickoff est neutralise (sinon la grille serait
close d'entree et rien ne serait saisissable) et la cloture automatique les
ignore (elle les fermerait avant qu'on ait pu pronostiquer). Les scores sont
donc visibles pendant la saisie : c'est un test de plomberie, pas un test
d'equite.

**Simulation acceleree.** Avec `MOCK_ESPN=1`, quatre matchs fictifs avec des
kickoffs a +5, +10, +15 et +20 minutes. Les scores avancent d'un quart-temps
toutes les 2 min 30, puis passent en `final` ; tout est termine 30 minutes
apres la creation. Ici le verrouillage s'applique normalement — c'est
justement ce qu'on vient voir. Les equipes sont imaginaires (Aurochs
d'Ardenne, Bisons du Brabant…), aucune abreviation NFL n'est reutilisee, et
les identifiants de match sont prefixes `TEST-SIM-`.

**Isolement.** Une semaine de test :

- porte `TEST` dans son libelle, donc partout ou un libelle de semaine
  s'affiche (onglets, grille, historique du joueur, page match, admin), plus
  une pastille dediee sur les pages pronostics et classement ;
- est exclue du classement general, du graphe d'evolution, des statistiques et
  de l'historique du profil joueur. Elle n'apparait que dans le classement
  **hebdomadaire** de sa propre semaine — c'est la qu'on verifie que les points
  ont bien ete calcules ;
- n'est jamais la semaine affichee par defaut, ni la cible du rappel du jeudi ;
- occupe un numero reserve (90-99), hors d'atteinte du calendrier reel, et un
  snapshot lance sur ce numero est refuse plutot que d'ecraser la semaine.

Elle reste visible de tous les joueurs, marquee comme telle.

**Purge.** « Supprimer les semaines TEST » efface les semaines marquees et tout
ce qui en depend — points, pronostics, barèmes figes, matchs — dans l'ordre des
cles etrangeres, puis refait le controle d'orphelins et l'affiche. Les vraies
semaines ne sont pas touchees.

---

## 8. Tests

```bash
npm test          # suite complete (113 tests)
npm run test:watch
npm run check     # svelte-check / TypeScript

npx vitest run src/lib/server/testing.test.ts   # cycle d'une semaine de test
npx vitest run src/lib/server/db/migrate.test.ts
```

Aucun test ne sort de la machine : le rejeu n'est couvert que par ses
validations pures, le chemin reseau est a verifier a la main via `/admin` apres
une evolution de l'API ESPN.

Les tests couvrent les exemples chiffres de la spec (p = 0,80 → 31 pts,
0,50 → 50, 0,35 → 71, 0,20 → 125, ≤ 0,10 → 250), le de-vig, les bonus, le match
nul, les multiplicateurs de playoffs, l'idempotence, et la tolerance du client
ESPN aux reponses incompletes.

**Les deux modes de saisie sont chiffres de part en part**, avec les memes
exemples que la section 4 (`LV @ KC`, 31 / 125 pts, KC 24 – LV 20) : ecart
exact (47 pts), ecart rate (31), mauvais vainqueur (0), nul predit sur un vrai
nul (117, sur la moyenne des baremes), nul predit sur un match avec vainqueur
(0), equipe choisie sur un match nul (16), et la comparaison qui montre le
plafond du mode A — 47 pts la ou le meme ecart saisi comme score exact en
vaudrait 62. La coherence de saisie est testee mode par mode : ecart ≥ 1 avec
equipe, ecart 0 sans equipe, et le refus de tout le reste.

Deux suites sortent du pur calcul :

- `db/migrate.test.ts` rejoue la montee de version sur une base **deja en v1**
  et peuplee, pas seulement sur une base vierge : c'est le chemin qu'empruntera
  la base de production. Il verifie qu'aucune semaine existante ne devient une
  semaine de test au passage, et que la v3 — la seule migration qui **recopie**
  des donnees, `picks` etant reconstruite — repasse chaque pronostic existant en
  mode « score » a l'identique, index uniques et cles etrangeres compris.
- `testing.test.ts` ouvre une base jetable et deroule le cycle d'une semaine de
  simulation — creation, pronostics **dans les deux modes**, verrouillage a la
  seconde du kickoff, calcul des points — puis verifie que la purge ne laisse
  **aucune ligne orpheline** et n'entame pas la vraie semaine posee a cote. Un
  pronostic mode A y traverse toute la chaine, de la saisie jusqu'a la ligne de
  points, nul predit sans equipe inclus.

---

## 9. Hors perimetre v1

Pas de spread ni de props, pas d'application native (PWA installable), pas de
notifications push. Le rappel email du jeudi existe mais est desactive par
defaut (`mail.reminder_enabled`).
