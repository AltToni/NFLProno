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

### Ce qu'on pronostique

Pour chaque match, deux choses : **l'equipe gagnante** et **l'ecart de points**.
L'ecart est un entier libre de 1 a 60 — il n'y a pas de liste imposee. Ou
« Match nul », qui ne designe alors aucune equipe.

Designer la bonne equipe suffit a gagner les **points de base** du match.
L'ecart, lui, decide du **bonus**.

#### Le bonus de rarete

**Plus l'ecart que tu vises est improbable, plus le bonus est gros.**

```
bonus_exact(m) = clamp(k / f(m), 25 %, 200 %)
bonus          = bonus_exact(m_predit) x max(0, 1 - 0,25 x |m_predit - m_reel|)
```

`f(m)` est la frequence historique de l'ecart `m`, mesuree sur les **2895
matchs** de saison reguliere joues entre **2015 et 2025**. La table est produite
par `scripts/analyse-ecarts.ts` et **figee dans le depot** (`src/lib/ecarts-nfl.json`) :
un bareme qui bouge sous les joueurs en cours de saison n'est plus un bareme.
La regenerer est un geste explicite.

`k` est calibre par le script pour que le bonus **moyen**, pondere par la
frequence reelle des ecarts, vaille exactement 100 % : le bareme **redistribue**
les points entre ecarts banals et ecarts rares, il n'en cree pas.

Quelques valeurs de la table :

| Ecart vise | Frequence | Bonus si exact |
|---|---:|---:|
| Match nul (0) | 0,35 % | +200 % |
| 3 | 14,65 % | +26 % |
| 6 | 6,94 % | +54 % |
| 7 | 8,67 % | +44 % |
| 10 | 4,87 % | +77 % |
| 14 | 5,11 % | +74 % |
| 17 | 3,45 % | +109 % |
| 21 | 2,21 % | +171 % |
| 28 | 1,55 % | +200 % |

Au-dela de 30 points, tous les ecarts partagent la meme frequence : pris un par
un ils sont trop rares pour en porter une propre, et un ecart de 34 n'est pas
plus previsible qu'un de 31.

**Deux exemples chiffres**, sur un match ou l'equipe choisie vaut 100 points de
base :

> **Tu annonces +3.** C'est le resultat le plus courant du football americain —
> un panier a la derniere seconde — et il sort dans un match sur sept. Le bonus
> est proche du plancher : **+26 %**. Tomber pile rapporte `100 x 1,26` =
> **126 points**. Rate d'un point, il reste les trois quarts du bonus :
> `100 x 1,19` = **119 points**.
>
> **Tu annonces +12.** Un ecart de douze points ne sort que dans 1,8 % des
> matchs : le bonus tape le plafond, **+200 %**. Tomber pile rapporte
> `100 x 3` = **300 points**, plus du double de l'exemple precedent. Rate de
> deux points, il en reste la moitie : `100 x 2` = **200 points**.

#### Rater son ecart

Le bonus ne tombe pas d'un coup : chaque point d'erreur en retire un quart.

| Erreur sur l'ecart | Part du bonus conservee |
|---|---:|
| pile dessus | 100 % |
| ± 1 | 75 % |
| ± 2 | 50 % |
| ± 3 | 25 % |
| ± 4 et au-dela | 0 % |

Le vainqueur, lui, reste acquis : les points de base sont gagnes des que la
bonne equipe est designee, quel que soit l'ecart annonce.

**Consequence assumee de la formule.** Le bonus depend de l'ecart **annonce**,
pas de l'ecart reel. Viser une valeur rare et la rater d'un point peut donc
rapporter davantage que toucher pile une valeur banale : sur un match qui finit
a +3, annoncer `+2` (rate d'un point, mais 4,6 % de frequence) rapporte plus
qu'annoncer `+3` (pile, mais 14,7 %). C'est un pari sur la rarete autant que sur
le resultat, et c'est teste comme tel (`scoring.test.ts`).

**Le nul predit** suit exactement la meme mecanique, avec `f(0)`. Le nul est
l'issue la plus rare du jeu — 10 matchs sur 2895, soit 0,35 % — donc son bonus
est au plafond. Comme il ne designe aucune equipe, son enjeu est la moyenne des
deux baremes (voir interpretation 2 ci-dessous) : c'est le plus gros gain
unitaire du jeu, et de loin le plus difficile a decrocher.

#### Les reglages

Tout ce qui pilote le bonus est editable dans `/admin`, groupe **Bonus de
rarete** :

| Reglage | Defaut | Role |
|---|---|---|
| `bonus.k` | 0,037724 | numerateur ; calibre pour un bonus moyen de 100 % |
| `bonus.plancher` | 0,25 | bonus minimal, meme sur l'ecart le plus banal |
| `bonus.plafond` | 2 | bonus maximal, meme sur l'ecart le plus rare |
| `bonus.pas` | 0,25 | bonus perdu par point d'erreur |

La table `f(m)`, elle, **n'est pas un reglage** : c'est une mesure. Elle vit
dans `src/lib/ecarts-nfl.json`, versionnee avec le code, et ne change que si on
relance le script d'analyse et qu'on commite le resultat. Modifier `k` sans
recalibrer casse la propriete de moyenne a 100 % — le script la recalcule.

#### La carte de saisie

Une carte de `/pronostics`, ici avec un ecart de 6 points annonce sur KC :

```
 19:00                                        dans 2 j 4 h · details

     LV  125 pts      @      KC  31 pts             <- choix en bleu

   [            Match nul            ]

   Ecart annonce
   [  6  ]   +54 % si l'ecart est exact             <- suit la frappe

   [ +3 ] [ +7 ] [ +6 ] [ +10 ] [ +14 ] [ +4 ]      <- raccourcis

   Soit KC +6 — +54 % si l'ecart est exact, et un quart de moins
   par point d'erreur (rien au-dela de 4).
```

Le pourcentage a cote du champ **se met a jour a chaque frappe** : c'est lui qui
transforme le choix d'un ecart en arbitrage plutot qu'en devinette. Les six
raccourcis sont les ecarts les plus frequents, proposes pour eviter de taper les
cas courants — ce ne sont pas des choix imposes.

Une fois le match termine, la carte, la page match et l'historique du joueur
affichent le **detail du calcul** — `31 × (1 + 54 %)` — relu depuis les points
stockes, jamais recalcule : un bareme modifie apres coup ne doit pas produire
une explication en desaccord avec les points inscrits au classement.

#### Un seul bouton pour toute la grille

`/pronostics` n'a **qu'un bouton « Enregistrer »**, dans une barre collee en bas
de l'ecran, et il envoie les seize matchs d'un coup. La barre dit en permanence
ou on en est :

```
  3 match(s) sans pronostic — TB @ CIN, NO @ DET,
  NYJ @ TEN. Sans pronostic, c'est 0 point.        [ Enregistrer (5) ]
```

Chaque carte est traitee independamment cote serveur : une saisie incomplete ou
refusee **n'empeche jamais les autres d'etre ecrites**, elle remonte comme
message rouge sur sa propre carte. Une carte a laquelle on n'a pas touche n'est
pas une erreur — c'est un avertissement, et rien n'est reecrit inutilement.

Sur `/match/<id>`, les pronostics du groupe sont affiches **sous la forme
saisie** — « KC +6 » ou « 27–20 », avec l'ecart derive en dessous pour un score
predit : on voit ce que chacun a joue, et comment.

### Points

```
base  = clamp(round(25 / p), 25, 250)
```

| Resultat | Points |
|---|---|
| Vainqueur correct | `base` |
| + bonus de rarete, selon l'ecart annonce | `base × (1 + bonus)` — de `base × 1,25` a `base × 3` |
| Vainqueur incorrect | 0 |
| Match nul | `base × 0,5` de l'equipe choisie |
| Match nul predit (ecart 0) | `base × 3` — le nul est l'issue la plus rare |
| Nul predit, match avec vainqueur | 0 : aucune equipe a crediter |
| Match reporte / annule | 0 pour tous, match neutralise |
| Cotes absentes au snapshot | `p = 0,5` des deux cotes, signale dans l'admin |
| Pas de pronostic | 0 |

Playoffs (option desactivee par defaut) : Wild Card ×1,5, Divisional ×2,
Championships ×2,5, Super Bowl ×3.

Toutes ces constantes sont en base (`settings`) et editables dans `/admin`.

**Exemple chiffre** sur `LV @ KC` — 31 pts sur KC, 125 pts sur LV, resultat final
**KC 24 – LV 20**, soit un ecart reel de **4 points** :

| Pronostic saisi | Points |
|---|---|
| `KC +4` | **56** — pile dessus, sur un ecart peu frequent : `round(31 × 1,80)` |
| `KC +5` | **51** — rate d'un point, mais +5 est plus rare : `round(31 × 1,64)` |
| `KC +3` | **37** — rate d'un point lui aussi, mais +3 est l'ecart le plus banal du jeu |
| `KC +6` | 39 — rate de deux points, sur un ecart moyennement frequent |
| `KC +12` | 31 — rate de huit : le bonus est eteint, la base reste |
| `LV +3` | 0 — mauvais vainqueur |
| `Match nul` | 0 — le match a un vainqueur, aucune equipe n'etait designee |
| `LV +4` (si LV avait gagne de 4) | 225 — le meme ecart sur l'outsider : `round(125 × 1,80)` |

Les trois premieres lignes disent tout du bonus de rarete : `+5` et `+3` ratent
l'ecart du **meme point**, et pourtant `+5` rapporte 14 points de plus, parce
que c'est un resultat trois fois moins courant.

Si ce meme match avait fini **20 – 20**, un `Match nul` aurait rapporte
`round(78 × 3)` = **234 pts** — 78 etant la moyenne des deux baremes (voir
interpretation 2 ci-dessous), et 3 le facteur d'un bonus au plafond. Un `KC +3`
aurait touche `round(31 × 0,5)` = 16 pts au titre du match nul : un match nul
reel n'est jamais traite comme un ecart « rate de peu ».

**Deux points d'interpretation de la spec**, à trancher avant le coup d'envoi :

1. *Coherence du pronostic.* Le controle serveur exige qu'un ecart strictement
   positif designe une equipe, et qu'un ecart de 0 n'en designe aucune. L'ecart
   lui-meme est **libre** entre 1 et 60 : le bonus de rarete donnant a chaque
   valeur son propre bareme, il n'y a rien a restreindre de plus.
2. *Enjeu d'un nul predit.* « Match nul » ne choisit pas d'equipe, donc aucun
   des deux baremes ne s'impose. Les points en jeu sont la **moyenne des
   deux**, seule valeur neutre. Consequence assumee : si le match a finalement
   un vainqueur, ce pronostic vaut 0 — c'est le pari le plus rentable du jeu, et
   le plus risque.

Le module `src/lib/scoring.ts` est pur (ni base ni reseau) et couvert par
`npm test`.

### La page `/regles`

Tout ce qui precede est explique aux joueurs sur `/regles`, accessible depuis la
barre de navigation et depuis l'en-tete de la grille. L'exemple y est **fige** —
le meme `LV @ KC` a chaque visite — mais ses points ne sont pas ecrits en dur :
la page les fait calculer par `computeScore`, avec la configuration courante.
Une constante modifiee dans `/admin` est donc repercutee sur l'exemple, et la
page ne peut pas se mettre a decrire un barème qui n'est plus celui applique.

Le facteur affiche a cote de chaque ligne vient du barème, pas d'un
`points / enjeu` : les points etant arrondis a l'entier, le quotient donnerait
des facteurs qui ne sont la règle de personne.

Sur la page match et dans l'historique du joueur, c'est l'inverse : le detail
(`31 × (1 + 54 %)`) est relu **depuis les points stockes**, jamais recalcule.
Un barème modifie apres coup ne doit pas produire une explication en desaccord
avec les points deja inscrits au classement.

---

## 5. Architecture

```
scripts/
  analyse-ecarts.ts     one-shot : mesure f(m) sur 11 saisons ESPN, calibre k
  analyse-ecarts.md     rapport lisible produit par le script
src/
  lib/
    scoring.ts            barème (pur, teste)
    ecarts-nfl.json       table des frequences d'ecart, figee et versionnee
    nfl.ts, time.ts       libelles, formats belges, fuseaux
    types.ts              types partages serveur / composants
    components/           GameCard, MatchRow, Podium, ProgressRing, Avatar,
                          Icon, RankChart, Countdown, LocalTime
    server/
      db/                 schema Drizzle + migrations idempotentes
      espn.ts             client ESPN (retries, double source de cotes)
      sync.ts             snapshot hebdo + poll des scores
      results.ts          calcul des points (idempotent)
      standings.ts        classements, evolution des rangs, stats joueur
      picks.ts            lecture/ecriture des pronostics, verrouillage
      auth.ts, mail.ts    invitations, magic links, sessions, SMTP
      cron.ts, backup.ts  ordonnanceur et sauvegardes
      home.ts             donnees de l'accueil (activite, resultats, recap)
  routes/
    +page.svelte          accueil : hero, semaine en cours, recap, activite
    connexion/            code d'invitation + magic link
    pronostics/           grille de la semaine
    match/[id]/           pronostics du groupe + points
    classement/           general, hebdo, graphe d'evolution
    joueur/[id]/          historique et statistiques
    regles/               explication du bareme, exemple chiffre
    admin/                invitations, taches, reglages, corrections
```

### Systeme de design

Tout part de `src/app.css`, ou vivent les tokens. Trois couleurs portent le
sens, et une seule chacune :

| Token | Role |
|---|---|
| `--accent` (bleu `#2b52ec`) | **action** : boutons, onglet courant, equipe choisie |
| `--positive` (vert `#5fdf29`) | **points et reussite** — jamais un bouton |
| `--danger` (rouge) | erreur, mauvais pronostic |

Le reste est une echelle de bleu-noir (`--bg` → `--surface-3`) : les cartes se
detachent du fond par la clarte, pas par la bordure, qui reste a peine
visible. Les titres utilisent `--font-display`, une grotesque condensee **si le
systeme en a une** — aucune `@font-face`, donc aucune origine externe a
autoriser dans la CSP, et une police absente ne change que la graisse.

Les composants partages evitent de redecrire ces choix a chaque vue :
`Avatar` (photo ou initiales sur une teinte derivee du pseudo), `Icon` (SVG
inline, pas de police d'icones), `ProgressRing`, `MatchRow`, `Podium`.

**Navigation.** Barre horizontale au-dessus de 860 px, barre basse fixe en
dessous — l'application etant installable, la barre basse est ce qu'on attend
d'elle sur telephone. Les deux sont construites depuis **la meme liste**
d'entrees dans `+layout.svelte` ; seul le drapeau `mobile` decide de la
presence dans la barre basse, limitee a cinq destinations.

**Les enjeux ne quittent jamais un match.** Les points en jeu de chaque camp
sont affiches sur la carte de la grille (`GameCard`) *et* sur la ligne compacte
de l'accueil (`MatchRow`). C'est l'information qui rend le choix interessant :
elle doit etre lisible avant meme d'ouvrir la grille.

**Une seule ligue.** « Ma ligue » est une carte d'information : un nom
(reglage `league.name`, modifiable dans `/admin`) et le nombre de comptes
actifs. Il n'y a rien a creer, rejoindre ou quitter. Le nom est un reglage
*textuel* — `SETTING_DEFS` ne decrit que des nombres, d'ou l'API
`getTextSetting` / `setTextSetting` a cote, qui ecrit dans la meme table
`settings` sans changement de schema.

**Activite recente.** Le flux annonce qu'un joueur a pronostique un match,
jamais **ce qu'il a joue** : le devoiler avant le coup d'envoi distribuerait
les reponses. Le resultat (✓ / ✗) n'apparait qu'une fois le match termine et
les points calcules — la meme regle que `gameDetail`, qui ne revele les
pronostics du groupe qu'apres le kickoff.

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

### Mise a jour : pousser sur `main`

**Le deploiement est automatique.** Un push sur `main` declenche
`.github/workflows/image.yml`, qui enchaine dans l'ordre : tests et typage,
build et publication de l'image sur GHCR, test de fumee du compose de
production, aller-retour sauvegarde/restauration, puis le job « Deploiement en
production ». Chaque etape depend de la precedente : **si quoi que ce soit est
rouge en amont, rien n'est deploye**.

Le job de deploiement se connecte en SSH au serveur et y execute :

```bash
cd /opt/nflprono && docker compose pull && docker compose up -d
```

Puis il verifie le resultat contre l'URL publique : attente de `/api/health` en
200 (60 s de patience, le temps des migrations), suivie du POST sur
`/connexion?/lien` qui prouve que la verification CSRF passe reellement derriere
le reverse proxy. **Si ce test echoue, le job est rouge** — la pile a redemarre,
mais l'alerte remonte.

Un seul deploiement tourne a la fois (`concurrency`) : deux push rapproches ne
peuvent pas se marcher dessus, le plus recent annule le precedent.

#### Lancement manuel

Sans nouveau commit — pour rejouer un deploiement apres une intervention sur le
serveur, ou apres correction d'un secret :

> Onglet **Actions** → workflow **Image Docker** → bouton **Run workflow** →
> branche `main` → **Run workflow**.

Le declenchement manuel rejoue le pipeline complet, tests compris. En ligne de
commande : `gh workflow run image.yml --ref main`.

#### Secrets a renseigner

Dans *Settings → Secrets and variables → Actions* :

| Secret | Role |
|---|---|
| `DEPLOY_HOST` | Nom d'hote ou IP du serveur |
| `DEPLOY_USER` | Compte SSH, membre du groupe `docker` |
| `DEPLOY_SSH_KEY` | Cle privee **sans passphrase**, dediee au deploiement |
| `DEPLOY_KNOWN_HOSTS` | Facultatif : sortie de `ssh-keyscan -H <hote>`. Sans lui l'empreinte du serveur est acceptee sans verification, et un avertissement apparait dans le job |

L'URL publique verifiee apres deploiement est ecrite dans le workflow
(`URL_PUBLIQUE`) : elle doit correspondre au `PUBLIC_BASE_URL` du serveur, sinon
le POST de verification retombe en 403.

### Premiere installation du serveur

A faire une fois, a la main. Le repertoire `/opt/nflprono` doit contenir le
compose de production (nomme `docker-compose.yml`, ou `compose.yaml`) et le
fichier `.env` — le job de deploiement ne fait que `pull` puis `up -d`, il ne
copie aucun fichier.

L'image est publiee sous deux tags : `latest`, et `sha-<commit>` qui est
immuable — **c'est celui qu'il faut epingler pendant la saison** si l'on veut
figer la version, `latest` bougeant a chaque push.

```bash
docker login ghcr.io -u AltToni          # PAT avec le scope read:packages
cp .env.example .env && $EDITOR .env
mkdir -p backup && sudo chown 1000:1000 backup   # le conteneur ecrit en uid 1000
docker compose up -d
```

Le compose derive `ORIGIN` de `PUBLIC_BASE_URL` et refuse de demarrer si elle
manque. Ce n'est pas cosmetique : sans `ORIGIN`, adapter-node reconstitue
l'origine en `http://` depuis l'en-tete `Host` du reverse proxy, la
verification CSRF echoue et **tous les formulaires renvoient 403**.

### Derriere un reverse proxy (serveur maison)

`Caddyfile` :

```
prono.tyvia.eu {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy gere le certificat TLS automatiquement. Cote UDR7, rediriger 80/443 vers
la machine hote — ou, pour ne rien exposer, utiliser un Cloudflare Tunnel :

```bash
cloudflared tunnel run --url http://127.0.0.1:3000 pronos
```

Dans les deux cas, `PUBLIC_BASE_URL` doit correspondre à l'URL publique
(`https://prono.tyvia.eu`), sans quoi les magic links pointeront au mauvais
endroit — et le deploiement automatique echouera a sa verification finale.

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
   l'occasion d'exercer la saisie de bout en bout — un ecart annonce, un
   « Match nul », un ecart volontairement rate — et de retrouver chaque
   pronostic sur `/match/<id>` puis dans le profil joueur.
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
- n'est jamais la cible du rappel du jeudi ni de la cloture automatique
  (`currentWeek()` les exclut) ;
- occupe un numero reserve (90-99), hors d'atteinte du calendrier reel, et un
  snapshot lance sur ce numero est refuse plutot que d'ecraser la semaine.

Elle reste visible de tous les joueurs, marquee comme telle, et son onglet
passe **apres** les vraies semaines. Elle ne devient la semaine ouverte par
defaut que s'il n'y a rien d'autre a montrer — le cas hors saison, ou aucune
vraie semaine n'est encore ouverte. C'est `defaultWeek()`, distincte de
`currentWeek()` justement pour que cette tolerance d'affichage ne deborde pas
sur les crons.

**Purge.** « Supprimer les semaines TEST » efface les semaines marquees et tout
ce qui en depend — points, pronostics, barèmes figes, matchs — dans l'ordre des
cles etrangeres, puis refait le controle d'orphelins et l'affiche. Les vraies
semaines ne sont pas touchees.

---

## 8. Tests

```bash
npm test          # suite complete (123 tests)
npm run test:watch
npm run check     # svelte-check / TypeScript

npx vitest run src/lib/server/testing.test.ts   # cycle d'une semaine de test
npx vitest run src/lib/server/db/migrate.test.ts
```

### Regenerer la table des ecarts

Geste rare et explicite — la table est figee entre deux saisons, jamais
recalculee en cours de route :

```bash
npx vite-node --config scripts/vite-node.config.ts scripts/analyse-ecarts.ts -- --depuis 2015 --jusqu-a 2025
```

Le script ecrit `src/lib/ecarts-nfl.json` (la table + le `k` recalibre) et
`scripts/analyse-ecarts.md` (le rapport lisible). Les reponses ESPN sont mises
en cache dans `.cache/espn/`, donc une seconde execution ne redemande rien. Si
une semaine manque, il **refuse d'ecrire** plutot que de figer un bareme sur des
donnees incompletes : relancer suffit.

La config vite dediee existe parce que le plugin SvelteKit restreint l'acces
disque a `src/` — un script pose dans `scripts/` n'y serait pas servi.

Apres regeneration, verifier que `npm test` passe toujours : le test de
calibration echoue si la moyenne ponderee s'ecarte de 100 %.

Aucun test ne sort de la machine : le rejeu n'est couvert que par ses
validations pures, le chemin reseau est a verifier a la main via `/admin` apres
une evolution de l'API ESPN.

Les tests couvrent les exemples chiffres de la spec (p = 0,80 → 31 pts,
0,50 → 50, 0,35 → 71, 0,20 → 125, ≤ 0,10 → 250), le de-vig, les bonus, le match
nul, les multiplicateurs de playoffs, l'idempotence, et la tolerance du client
ESPN aux reponses incompletes.

**Le bareme est chiffre de part en part**, avec les memes exemples que la
section 4 (`LV @ KC`, 31 / 125 pts, KC 24 – LV 20) : ecart exact sur un
resultat banal, ecart exact sur un resultat rare (au plafond), ecart rate de
±1, ±2 et ±4, mauvais vainqueur (0), nul predit sur un vrai nul (234, sur la
moyenne des baremes), nul predit sur un match avec vainqueur (0), et equipe
choisie sur un match nul (16). Un test verifie la **calibration** — le bonus
moyen pondere par les frequences vaut 100 % — et un autre fixe la consequence
assumee de la formule, ou viser rare et rater d'un point paie plus que viser
banal et tomber pile. La coherence de saisie est testee de bout en bout : ecart
≥ 1 avec equipe, ecart 0 sans equipe, borne haute, et le refus de tout le
reste.

Deux suites sortent du pur calcul :

- `db/migrate.test.ts` rejoue la montee de version sur une base **deja en v1**
  et peuplee, pas seulement sur une base vierge : c'est le chemin qu'empruntera
  la base de production. Il verifie qu'aucune semaine existante ne devient une
  semaine de test au passage, et que la **v4** — celle qui reconstruit `picks`
  et `scores` — convertit chaque score predit en vainqueur + ecart sans en
  perdre le sens (`27-20` devient `+7`, `20-20` devient un nul sans equipe),
  index uniques et cles etrangeres compris.
- `testing.test.ts` ouvre une base jetable et deroule le cycle d'une semaine de
  simulation — creation, saisie des pronostics, verrouillage a la seconde du
  kickoff, calcul des points — puis verifie que la purge ne laisse **aucune
  ligne orpheline** et n'entame pas la vraie semaine posee a cote. Un pronostic
  y traverse toute la chaine, de la saisie jusqu'a la ligne de points, nul
  predit sans equipe inclus.

---

## 9. Hors perimetre v1

Pas de spread ni de props, pas d'application native (PWA installable), pas de
notifications push. Le rappel email du jeudi existe mais est desactive par
defaut (`mail.reminder_enabled`).
