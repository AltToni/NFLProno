# HANDOFF — Pronos NFL 2026

Document de passation. Il décrit l'état réel du projet, ce qui a été vérifié et
ce qui ne l'a pas été, les décisions prises et pourquoi, les pièges connus, et la
suite dans l'ordre où l'aborder.

Dernière mise à jour : 24 juillet 2026.

---

## 1. État actuel — à lire en premier

**Le code est complet pour le périmètre v1. Il n'a jamais été exécuté.**

Il a été écrit sur un poste Windows verrouillé qui n'a **ni Node, ni npm, ni git,
ni Docker, ni winget** — seulement VS Code. Aucune commande n'a donc pu tourner :
pas de `npm install`, pas de compilation, pas de `svelte-check`, pas de `vitest`,
pas de démarrage du serveur.

Concrètement :

- Les 68 fichiers sont écrits et cohérents entre eux (imports, types, routes).
- Les versions de dépendances dans `package.json` ont été choisies de mémoire.
  **Attends-toi à de la dérive** : une ou deux majeures auront bougé.
- Les tests (`src/lib/scoring.test.ts`, `src/lib/server/espn.test.ts`) sont
  écrits mais n'ont jamais été lancés. Ils encodent les exemples chiffrés de la
  spec — s'ils passent, le barème est juste.
- Le projet n'est **pas** un dépôt git (`git init` impossible ici).

Traite donc ce code comme une **implémentation de référence à valider**, pas
comme un livrable éprouvé. La première session sur une machine outillée sera
faite de corrections de compilation, pas de conception.

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

| # | Critère | Où c'est implémenté |
|---|---|---|
| 1 | Invitation → compte → pronostic | `auth.ts:redeemInvite` + `routes/connexion/` |
| 2 | Enjeux figés au snapshot | `odds_snapshots` : une ligne par match, jamais réécrite (sauf forçage admin) |
| 3 | Refus après kickoff | `picks.ts:savePick` — contrôle serveur, pas seulement UI |
| 4 | Points conformes au §2 | `results.ts` + `scoring.ts` |
| 5 | Recalcul idempotent | `computeGameScores` supprime puis réécrit les lignes du match |
| 6 | Pronos masqués avant kickoff | `gameDetail()` renvoie une liste **vide** — rien ne part au client |

Aucun de ces six n'a été vérifié en exécution.

### Hors périmètre, comme prévu

Pas de spread ni de props, pas d'app native (PWA installable à la place), pas de
push. Le rappel email du jeudi existe mais est désactivé par défaut
(`mail.reminder_enabled`).

---

## 3. Ce qui reste

Par ordre de criticité.

### Bloquant avant tout déploiement

1. **Faire compiler.** `npm install`, `npm run check`, `npm test`. Corriger la
   dérive de versions. C'est le gros du travail restant.
2. **Valider le parsing ESPN sur des données réelles.** Lancer un snapshot sur
   une semaine passée de 2025 (données stables) et regarder ce qui atterrit dans
   `odds_snapshots`.
3. **Garde-fou preseason** (voir §5, piège n°2) — non implémenté.

### Avant l'ouverture aux joueurs

4. Icônes PNG réelles pour la PWA (actuellement SVG uniquement).
5. SMTP configuré et magic link testé de bout en bout.
6. Limitation de débit sur la demande de magic link (aucune actuellement).
7. Durée de validité du jeton de rappel email (voir §5, piège n°6).

### Confort, non bloquant

8. Tests d'intégration sur les services base de données (seuls le barème et le
   parsing ESPN sont couverts).
9. Ex aequo hebdomadaires : actuellement aucun vainqueur n'est enregistré en cas
   d'égalité, alors qu'on pourrait en stocker plusieurs.
10. Neutralisation automatique du Pro Bowl (seasontype 3, semaine 4).

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

### 2. La saison 2026 n'existe pas encore chez ESPN

En juillet, `getCurrentPeriod()` peut renvoyer `seasontype = 1` (présaison) ou
des données de la saison précédente. Or `weekLabel()` ne gère que les types 2
(régulière) et 3 (playoffs) — un snapshot lancé maintenant créerait une semaine
mal étiquetée.

*Non corrigé.* À faire : rejeter `seasontype = 1` dans `runSnapshot()`, ou le
mapper explicitement sur un libellé « Présaison — semaine N » exclu des
classements.

### 3. Le fallback core API n'est pas prouvé

`extractOdds()` gère plusieurs formes de moneyline (`moneyLine`,
`current.moneyLine.american`, `close`, `open`) parce que la forme exacte
renvoyée par `sports.core.api.espn.com` n'a **pas** été vérifiée sur une réponse
réelle. Le code est défensif et ne lèvera pas d'exception, mais il pourrait
silencieusement ne rien trouver et retomber sur 50/50.

*À valider en priorité* : appeler cette URL sur un vrai match à venir et
comparer avec ce que produit `extractOdds`.

### 4. `better-sqlite3` est un module natif

Il se compile depuis les sources (le `Dockerfile` installe `python3 make g++`
pour ça). Deux conséquences :

- `npm install` sur une machine et copie de `node_modules` vers une autre version
  de Node = binaire incompatible. Toujours réinstaller sur la cible.
- Le build Docker est plus lent que prévu à la première passe.

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

### 7. API drizzle non vérifiée à l'exécution

Trois constructions sont plausibles mais non prouvées :
`.returning({ id }).get()` sur un insert, `onConflictDoUpdate` avec cible
composite `[picks.userId, picks.gameId]`, et le typage des enums `text({ enum:
[...] })`. Ce sont les premiers endroits à regarder si `npm run check` crie.

### 8. Environnement de développement absent

Rappel : ce poste n'a rien. Toute la suite suppose une autre machine.

---

## 6. Prochaines étapes, dans l'ordre

### Étape 1 — Sortir le code du poste actuel

Copier `C:\Users\bnztnn\nfl-pronos` sur une machine avec Node 20+ et git, puis :

```bash
git init -b main
git remote add origin git@github.com:AltToni/NFLProno.git
git add .
git commit -m "Jeu de pronostics NFL - implementation initiale"
git push -u origin main
```

Le dépôt `AltToni/NFLProno` doit exister côté GitHub, et l'URL SSH suppose une
clé chargée. `.gitignore` couvre déjà `.env`, `data/`, `backup/` et `*.db` —
vérifie quand même qu'aucun secret réel ne traîne dans `.env.example`.

### Étape 2 — Faire compiler et passer les tests

```bash
npm install
npm run check     # attends-toi à des corrections ici
npm test          # barème + parsing ESPN
```

Si les tests du barème passent, les exemples chiffrés de la spec (p = 0,80 → 31
pts, 0,50 → 50, 0,35 → 71, 0,20 → 125, ≤ 0,10 → 250) sont validés et le cœur du
jeu est juste.

### Étape 3 — Valider ESPN sur données réelles

```bash
cp .env.example .env    # AUTH_SECRET + ADMIN_EMAIL suffisent
npm run dev
```

Puis, connecté en admin sur `/admin` :

1. Mettre `season.year` à **2025** dans les réglages.
2. Lancer un snapshot manuel sur la semaine 1, saison régulière.
3. Vérifier dans `/pronostics` que les enjeux affichés sont plausibles (un gros
   favori autour de 30 pts, un outsider au-delà de 100).
4. Vérifier dans `/admin` qu'aucun repli 50/50 n'a été signalé — s'il y en a, le
   fallback core API ne fonctionne pas (piège n°3).
5. Corriger un score dans `/admin/matchs`, vérifier le recalcul, relancer
   « Recalculer tous les points » deux fois et vérifier que les totaux ne bougent
   pas (critère d'acceptation 5).
6. Remettre `season.year` à 2026 et vider la base de test.

### Étape 4 — Corriger les manques identifiés

Garde-fou présaison (piège n°2), durée des jetons de rappel (piège n°6), icônes
PNG, limitation de débit sur `/connexion`.

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
- [ ] Snapshot de test sur la semaine 1 dès que le calendrier 2026 est publié,
      puis vider les pronostics de test.
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
