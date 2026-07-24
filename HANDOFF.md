# HANDOFF — Pronos NFL 2026

Document de passation. Il décrit l'état réel du projet, ce qui a été vérifié et
ce qui ne l'a pas été, les décisions prises et pourquoi, les pièges connus, et la
suite dans l'ordre où l'aborder.

Dernière mise à jour : 24 juillet 2026 (session d'exécution).

---

## 1. État actuel — à lire en premier

**Le code compile, les tests passent, et il a tourné sur données réelles.**

La session du 24 juillet 2026 a été faite sur une machine outillée (Node 24,
npm 11, git). Ce qui a changé depuis la rédaction initiale :

- `npm install` : **pas de dérive de versions**. Tout a résolu proprement, y
  compris `better-sqlite3` (module natif) qui s'est compilé sans intervention.
- `npm test` → **44/44**. Les exemples chiffrés de la spec sont validés
  (p = 0,80 → 31 pts, 0,50 → 50, 0,35 → 71, 0,20 → 125, ≤ 0,10 → 250).
- `npm run check` → **0 erreur, 0 warning**. `npm run build` → OK.
- Le projet est un dépôt git, poussé sur `origin/main`.
- L'application a démarré, un snapshot a été lancé sur des données ESPN réelles
  (semaine 1 de 2025 *et* de 2026), et les 6 critères d'acceptation ont été
  vérifiés en exécution (§2).

**Neuf défauts réels ont été trouvés et corrigés** — dont un qui aurait figé le
barème de la saison 2026 sur le calendrier 2025 (§5, piège n°9). Le détail est
dans les commits `9edb9c8` et `597a678`.

Ce qui reste non éprouvé : le déploiement Docker, l'envoi SMTP réel, et le
comportement en charge. Voir §3.

---

## 2. Ce qui est fait

### Couvert intégralement

| Domaine | Fichiers | État |
|---|---|---|
| Barème (de-vig, points, bonus, playoffs) | `src/lib/scoring.ts` | Module pur, testé sur le papier |
| Client ESPN | `src/lib/server/espn.ts` | Retries, timeouts, double source de cotes |
| Schéma + migrations | `src/lib/server/db/` | Migrations idempotentes via `user_version`, sans CLI |
| Snapshot hebdo | `src/lib/server/sync.ts` | Fige le barème, ouvre la semaine |
| Calcul des points | `src/lib/server/results.ts` | Idempotent (delete + réécriture) |
| Classements + stats | `src/lib/server/standings.ts` | Général, hebdo, évolution des rangs, profil |
| Pronostics + verrouillage | `src/lib/server/picks.ts` | Contrôle serveur au kickoff |
| Auth | `src/lib/server/auth.ts` | Invitations, magic links, sessions, jetons HMAC |
| Crons | `src/lib/server/cron.ts` | 5 tâches, journal, relance manuelle |
| Sauvegardes | `src/lib/server/backup.ts` | `VACUUM INTO` + rotation |
| Écrans | `src/routes/` | Connexion, pronostics, match, classement, profil, admin |
| Conteneurisation | `Dockerfile`, `docker-compose.yml` | Multi-stage, healthcheck, volumes |

### Les 6 critères d'acceptation

| # | Critère | Où c'est implémenté | Vérifié le 24/07/2026 |
|---|---|---|---|
| 1 | Invitation → compte → pronostic | `auth.ts:redeemInvite` + `routes/connexion/` | ✅ code créé, compte ouvert, magic link consommé, pronostic enregistré |
| 2 | Enjeux figés au snapshot | `odds_snapshots` : une ligne par match, jamais réécrite (sauf forçage admin) | ✅ 2e snapshot de la même semaine : « 0 barèmes écrits, 16 conservés » |
| 3 | Refus après kickoff | `picks.ts:savePick` — contrôle serveur, pas seulement UI | ✅ POST direct sur un match commencé → 400 « ce pronostic est verrouillé » |
| 4 | Points conformes au §2 | `results.ts` + `scoring.ts` | ✅ 33×2=66 (score exact), 65×1,5=98 (écart exact), 50 (vainqueur seul), 0 (vainqueur faux) |
| 5 | Recalcul idempotent | `computeGameScores` supprime puis réécrit les lignes du match | ✅ 3 recalculs consécutifs : total identique, aucune ligne dupliquée |
| 6 | Pronos masqués avant kickoff | `gameDetail()` renvoie une liste **vide** — rien ne part au client | ✅ pronostic d'un 2e joueur invisible dans le HTML et dans les données sérialisées |

Vérifié aussi : la correction manuelle d'un score pose `manual_override = 1` et
le poll ESPN suivant ne l'écrase pas.

Méthode : requêtes HTTP directes sur le serveur de dev avec une vraie session,
et lectures SQL de la base. Les pronostics du critère 4 ont dû être insérés en
base (les matchs de 2025 étant tous verrouillés, c'est le seul moyen d'exercer
le calcul de points sur des scores réels).

### Hors périmètre, comme prévu

Pas de spread ni de props, pas d'app native (PWA installable à la place), pas de
push. Le rappel email du jeudi existe mais est désactivé par défaut
(`mail.reminder_enabled`).

---

## 3. Ce qui reste

Par ordre de criticité.

### Fait le 24/07/2026

- ~~Faire compiler~~ → `npm test` 44/44, `npm run check` 0/0, `npm run build` OK.
- ~~Valider le parsing ESPN sur données réelles~~ → snapshots 2025 S1 et 2026 S1,
  16 matchs chacun, **aucun repli 50/50**.
- ~~Garde-fou présaison~~ → implémenté dans `runSnapshot()`.

### Avant l'ouverture aux joueurs

1. **SMTP configuré et magic link testé de bout en bout.** Seul le mode « lien
   écrit dans les logs » a été éprouvé.
2. **Déploiement Docker jamais testé.** Le `Dockerfile` n'a pas été construit.
   Attention : `better-sqlite3` se compile depuis les sources (§5, piège n°4).
3. Icônes PNG réelles pour la PWA (actuellement SVG uniquement).
4. Limitation de débit sur la demande de magic link (aucune actuellement).
5. Durée de validité du jeton de rappel email (voir §5, piège n°6).

### Confort, non bloquant

6. Tests d'intégration sur les services base de données (seuls le barème et le
   parsing ESPN sont couverts par `npm test`).
7. Ex aequo hebdomadaires : actuellement aucun vainqueur n'est enregistré en cas
   d'égalité, alors qu'on pourrait en stocker plusieurs.
8. Neutralisation automatique du Pro Bowl (seasontype 3, semaine 4).
9. `npm run build` **crée `data/nfl.db`** : importer les modules serveur suffit à
   ouvrir la base et jouer les migrations. Sans conséquence, mais surprenant.

---

## 4. Décisions prises

### Sur le barème — deux interprétations de la spec à valider

**a) Match nul avec score exact prédit.** La spec §2.4 dit « points de base +
bonus d'écart » pour qui prédit un nul. L'implémentation applique la règle
générale du §2.3 : si le score du nul est exact au point près, c'est le bonus de
score exact (×2) qui s'applique ; sinon le bonus d'écart (×1,5).

*Pourquoi* : la règle générale « score exact remplace bonus d'écart » est plus
cohérente que d'avoir un cas particulier où nailer le score exact ne rapporte
rien de plus. Cas très rare de toute façon (~1 nul par 2 saisons NFL).

*Pour coller au texte à la lettre* : mettre `scoring.exact_bonus_pct` à 0,5 dans
l'admin.

**b) Cohérence score / vainqueur.** Un pronostic dont le score donnerait la
victoire à l'équipe non choisie est refusé, côté client **et** serveur. Le nul
reste autorisé quelle que soit l'équipe choisie, puisque le §2.4 le prévoit
explicitement.

*Pourquoi* : sans cette règle, « je prends KC » + « 17-24 » est ambigu et casse
le calcul du bonus d'écart.

### Sur l'architecture

**Migrations sans CLI.** `src/lib/server/db/migrate.ts` joue des tableaux de SQL
numérotés, suivis par `PRAGMA user_version`. Le conteneur se suffit à lui-même,
aucune étape `drizzle-kit push` au déploiement. `drizzle.config.ts` reste fourni
pour `npm run db:studio`.

*Pourquoi* : mono-container, redémarrage sans intervention. Le prix à payer :
ajouter une migration = ajouter un tableau dans `MIGRATIONS`, jamais modifier un
tableau existant.

**Double source de cotes.** Le snapshot complète chaque match sans moneyline via
`sports.core.api.espn.com/.../competitions/{id}/odds` avant de tomber sur le
repli 50/50.

*Pourquoi* : voir §5, piège n°1 — c'est la découverte la plus importante de la
session.

**Verrouillage calculé, pas planifié.** Aucun cron ne verrouille les matchs :
c'est une comparaison `now() >= kickoff_utc` à la lecture et à l'écriture. Un
match se verrouille donc exactement à son kickoff, même si l'ordonnanceur est
tombé.

**Corrections manuelles protégées.** Un score corrigé dans `/admin/matchs` pose
`manual_override = 1` ; le poll ESPN ne l'écrase plus jusqu'à ce qu'un admin
rétablisse explicitement la synchronisation.

**Confidentialité par le serveur, pas par le CSS.** `gameDetail()` renvoie une
liste vide avant le kickoff. Les pronostics des autres ne sont jamais sérialisés
vers le navigateur, donc impossibles à lire dans le HTML ou les devtools.

**Jetons hachés.** Sessions et magic links stockent `HMAC-SHA256(token,
AUTH_SECRET)`, jamais le jeton en clair. Conséquence : **changer `AUTH_SECRET`
déconnecte tout le monde** et invalide les magic links en vol.

### Sur l'interface

**Graphe d'évolution sans couleur par joueur.** À 25 joueurs, une palette
catégorielle serait illisible et indistinguable en vision des couleurs
déficiente. Toutes les courbes sont neutres ; seule celle du joueur connecté (ou
celle survolée) est mise en avant, avec étiquette directe. Le tableau juste
au-dessus fournit la vue chiffrée.

**Heures locales après hydratation.** `LocalTime.svelte` rend l'heure belge côté
serveur puis bascule sur le fuseau du navigateur dans un `$effect`. Sans ça,
écart de rendu à l'hydratation pour tout joueur hors Belgique.

**Un formulaire par match.** Chaque carte poste indépendamment via `use:enhance`.
Fonctionne aussi sans JavaScript (rechargement complet). Pas d'enregistrement
global qui risquerait d'écraser un match verrouillé entre-temps.

---

## 5. Pièges rencontrés

### 1. ESPN retire les cotes des matchs terminés — **vérifié**

Une requête réelle sur `scoreboard?week=1&seasontype=2&year=2025` renvoie des
`competitions[0]` **sans champ `odds`** pour les matchs déjà joués. Les cotes
disparaissent aussi parfois plusieurs jours avant le kickoff.

*Conséquence* : le snapshot du mercredi n'est pas un confort, c'est la seule
fenêtre où les données existent. Si un mercredi le cron échoue et que personne
ne le voit, les cotes de la semaine sont perdues — le repli 50/50 s'appliquera
et tous les matchs vaudront 50 points.

*Surveille le journal des tâches dans `/admin` chaque mercredi matin de la
saison.* C'est le point de fragilité principal du système.

### 2. La saison 2026 chez ESPN — **corrigé**

Au 24 juillet 2026, le scoreboard sans paramètre renvoie déjà `season.year =
2026`, `seasontype = 2`, `week = 1`, et le calendrier complet de la semaine 1
(coup d'envoi le 10 septembre). ESPN saute la présaison dans sa réponse par
défaut, du moins aujourd'hui.

Le risque subsiste en août, quand ESPN bascule sur `seasontype = 1` :
`weekLabel()` produirait une « Semaine 3 » de présaison indiscernable de la
semaine 3 régulière dans les classements. `runSnapshot()` **rejette désormais**
tout `seasontype` autre que 2 ou 3.

### 3. Le fallback core API — **prouvé, il fonctionne**

Vérifié sur les 16 matchs de la semaine 1 de 2025 (tous terminés, donc sans
`odds[]` au scoreboard) : les 16 barèmes ont été écrits, **aucun repli 50/50**.
Le `raw_json` stocké contient bien les `$ref` de `sports.core.api.espn.com`,
preuve que les cotes viennent du repli.

La forme réelle est la plus simple des candidates gérées par `teamMoneyline()` :
`homeTeamOdds.moneyLine` est un nombre brut (`-400`), premier candidat testé.

Deux observations utiles :

- Sur les matchs **passés**, le bookmaker retenu est ESPN BET (id 58), celui que
  `PREFERRED_PROVIDER_IDS` privilégie.
- Sur les matchs **à venir** (semaine 1 de 2026), ESPN BET est absent et c'est
  DraftKings qui sort. La sélection par défaut « n'importe quel bookmaker
  fournissant les deux moneylines » joue donc son rôle — et jouera sans doute le
  mercredi de chaque semaine de la saison.

### 4. `better-sqlite3` est un module natif

Il se compile depuis les sources (le `Dockerfile` installe `python3 make g++`
pour ça). Deux conséquences :

- `npm install` sur une machine et copie de `node_modules` vers une autre version
  de Node = binaire incompatible. Toujours réinstaller sur la cible.
- Le build Docker est plus lent que prévu à la première passe.

En pratique, l'installation sur Node 24 (Windows) s'est faite sans intervention :
un binaire précompilé était disponible, aucune chaîne de compilation requise.
Le build Docker (image Alpine) reste à éprouver.

### 5. Le recalcul s'appuie sur `updated_at`

`computePendingScores()` recalcule un match si le nombre de lignes `scores` ne
correspond pas au nombre de pronostics, ou si `min(computed_at) < updated_at`.
Pour que ça marche, `upsertGames()` ne met à jour `updated_at` **que si un champ
a réellement changé** — sinon chaque poll de 15 minutes déclencherait un recalcul
complet.

Si tu ajoutes un champ à `games`, pense à ce que la comparaison le prenne en
compte.

### 6. Les liens des emails de rappel expirent en 30 minutes

`TASKS.reminder` génère un magic link par joueur à 08:00 le jeudi. Ces jetons ont
la même durée de vie que ceux de connexion : **30 minutes**. Un joueur qui ouvre
son mail à midi tombera sur un lien mort.

*Non corrigé.* Deux options : allonger la durée pour ces jetons, ou pointer
simplement sur `/pronostics` sans jeton (le joueur a déjà une session de 60
jours dans la plupart des cas).

### 7. API drizzle — **une vraie erreur, corrigée**

`onConflictDoUpdate` avec cible composite et le typage des enums étaient bons.
En revanche `db.transaction()` était mal utilisé sur **quatre** sites (`auth.ts`,
`sync.ts` ×2, `results.ts`) :

```ts
const tx = db.transaction(() => { ... });
tx();   // TypeError: tx is not a function
```

L'API better-sqlite3 brute renvoie une fonction à appeler ; celle de **Drizzle
exécute le callback immédiatement** et renvoie sa valeur. L'inscription d'un
joueur, le snapshot et le calcul des points plantaient donc tous les trois au
premier appel. `db/migrate.ts` utilise le driver brut et était, lui, correct.

*Leçon* : ne pas mélanger les deux APIs. Dans `src/lib/server/`, `db` est
toujours l'instance Drizzle.

### 8. `npm run dev` ignorait le fichier `.env` — **corrigé**

Tout le code serveur lit `process.env` directement. C'est correct en production
(docker-compose fournit les variables via `env_file`), mais Vite ne peuple
**pas** `process.env` à partir de `.env`. Le flux documenté au README §1
(`cp .env.example .env && npm run dev`) partait donc silencieusement sur les
valeurs par défaut : pas de compte admin créé, `CRON_ENABLED=0` ignoré,
`AUTH_SECRET` retombant sur un secret de développement.

`vite.config.ts` fait maintenant le pont, sans écraser les variables réelles de
l'environnement.

### 9. ESPN ignore le paramètre `year` — **le plus grave, corrigé**

`getScoreboard()` construisait :

```
scoreboard?week=1&seasontype=2&year=2026
```

ESPN **ignore `year`** (et `season`) et renvoie la saison courante à ses yeux :
au 24 juillet 2026, cette URL retournait la semaine 1 de **2025** — la réponse
s'auto-déclarant `season.year = 2025`. Vérifié : `dates=2026` renvoie bien 2026.

*Ce que ça donnait* : un snapshot demandé sur 2026 créait une semaine étiquetée
2026 remplie des matchs et des cotes de 2025. Le mercredi de la semaine 1, le
barème de la saison aurait été figé sur le mauvais calendrier — et comme le
critère 2 interdit de réécrire un snapshot, il aurait fallu forcer à la main.

*Corrigé* sur deux niveaux : l'URL porte désormais la saison sur `dates`, et
`getScoreboard()` **refuse** toute réponse dont la saison ne correspond pas à
celle demandée. Un test de non-régression verrouille la forme de l'URL.

*À retenir* : les paramètres de cette API ne sont pas documentés et ne se
comportent pas comme leur nom le suggère. Toute évolution du client ESPN doit
être re-vérifiée sur une réponse réelle, pas déduite.

### 10. Un pronostic sans score valait « nul 0-0 » — **corrigé**

`Number(null)` et `Number('')` valent `0`, et `0-0` passe la validation
(c'est un pronostic de match nul légitime). Un envoi sans les champs de score —
le chemin sans JavaScript, que le projet revendique — enregistrait donc
silencieusement un pari sur le nul, écrasant au passage un pronostic valide.

Rejet explicite côté serveur, `required` sur les deux champs du formulaire. Le
`0-0` réellement saisi reste accepté.

### 11. Environnement de développement

L'implémentation initiale a été écrite sur un poste sans Node ni git. Ce n'est
plus le cas : le projet vit dans `C:\dev\nfl-pronos` sur une machine outillée.

---

## 6. Prochaines étapes, dans l'ordre

Les étapes 1 à 3 de la version précédente de ce document (sortir le code du
poste, faire compiler, valider ESPN) sont **faites**. Reprendre ici.

### Reprendre le travail

```bash
cd C:\dev\nfl-pronos
npm install          # si node_modules absent
npm run dev          # .env local deja en place, CRON_ENABLED=0
```

Sans SMTP, le magic link s'affiche dans la console : il suffit de le copier.
Le `.env` local pointe sur `./data/nfl.db` et `CRON_ENABLED=0` — c'est un
environnement de test, pas un modèle de production.

Pour repartir d'une base vierge : arrêter le serveur, supprimer `data/`.
(Le fichier se recrée au premier démarrage, migrations comprises.)

### Étape 4 — Corriger les manques restants

Durée des jetons de rappel (piège n°6), icônes PNG, limitation de débit sur
`/connexion`. Le garde-fou présaison est fait.

### Étape 5 — Déployer

Suivre la section 6 du `README.md` (Caddy ou Cloudflare Tunnel, ou VPS EU).
Générer un vrai `AUTH_SECRET`, renseigner `PUBLIC_BASE_URL` et le SMTP, puis
tester un magic link de bout en bout depuis un téléphone.

### Étape 6 — Checklist d'avant-saison (fin août)

- [ ] Figer les constantes du barème dans `/admin` — après le premier snapshot,
      les changer nécessite un recalcul complet.
- [ ] Décider de l'option playoffs (`playoffs.enabled`) **avant** la semaine 1.
- [ ] Trancher l'interprétation du nul avec score exact (§4a).
- [ ] Créer les invitations et les distribuer.
- [ ] ~~Snapshot de test sur la semaine 1 dès que le calendrier 2026 est
      publié~~ — fait le 24/07/2026, calendrier déjà en ligne (S1 le 10 sept.),
      cotes DraftKings présentes, aucun repli 50/50. **Vider la base de test
      avant l'ouverture aux joueurs.**
- [ ] Vérifier que la sauvegarde quotidienne écrit bien sur un **second** support.
- [ ] Mettre un rappel personnel : regarder le journal des tâches chaque mercredi
      matin de la saison.

---

## 7. Où chercher quoi

```
src/lib/scoring.ts              tout le barème, pur et testable
src/lib/server/espn.ts          parsing ESPN, c'est là que ça cassera en premier
src/lib/server/sync.ts          snapshot hebdo + poll des scores
src/lib/server/results.ts       calcul des points
src/lib/server/cron.ts          les 5 tâches et leur planification
src/lib/server/db/migrate.ts    ajouter une migration = ajouter un tableau
src/routes/admin/               tout le pilotage manuel
```

Le `README.md` couvre l'installation, les variables d'environnement, le détail
du barème et l'exploitation courante. Ce document-ci couvre le *pourquoi* et le
*reste à faire*.

---

## 8. Journal des sessions

**24 juillet 2026 — première exécution.** Sortie du code du poste verrouillé,
compilation, exécution sur données ESPN réelles, vérification des 6 critères
d'acceptation. Neuf défauts trouvés et corrigés (commits `9edb9c8`, `597a678`) :

| # | Défaut | Gravité |
|---|---|---|
| 1 | `sveltekit()` importé du mauvais paquet | bloquait tout démarrage |
| 2 | `db.transaction()` mal utilisé sur 4 sites | inscription, snapshot et calcul des points plantaient |
| 3 | ESPN ignore `year=` : la saison 2026 renvoyait 2025 | aurait figé le barème sur le mauvais calendrier |
| 4 | Pronostic sans score enregistré comme nul 0-0 | pari involontaire, écrase un pronostic valide |
| 5 | `.env` ignoré par `npm run dev` | échec silencieux du flux documenté |
| 6 | `rawJson` ESPN sérialisé vers le navigateur | 6 ko morts par page match |
| 7 | Garde-fou présaison absent | semaines mal étiquetées en août |
| 8 | `GameCard` figeait la valeur initiale du pronostic | champs périmés après rafraîchissement |
| 9 | vitest 2 / Vite 6 : deux jeux de types | `npm run check` en échec |

Le barème lui-même n'a demandé **aucune correction** : les 31 tests de
`scoring.ts` sont passés du premier coup, et les points calculés sur de vrais
résultats 2025 correspondent à la spec.
