import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * Toutes les dates sont stockees en secondes epoch UTC (integer).
 * L'affichage local (Europe/Brussels ou fuseau du navigateur) se fait cote UI.
 */

export const users = sqliteTable(
	'users',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		pseudo: text('pseudo').notNull(),
		email: text('email').notNull(),
		role: text('role', { enum: ['admin', 'joueur'] })
			.notNull()
			.default('joueur'),
		avatar: text('avatar'),
		active: integer('active').notNull().default(1),
		createdAt: integer('created_at').notNull()
	},
	(t) => ({
		emailIdx: uniqueIndex('users_email_uidx').on(t.email),
		pseudoIdx: uniqueIndex('users_pseudo_uidx').on(t.pseudo)
	})
);

export const invites = sqliteTable(
	'invites',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('code').notNull(),
		email: text('email'),
		note: text('note'),
		expiresAt: integer('expires_at'),
		usedBy: integer('used_by').references(() => users.id),
		usedAt: integer('used_at'),
		createdBy: integer('created_by').references(() => users.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => ({
		codeIdx: uniqueIndex('invites_code_uidx').on(t.code)
	})
);

/** Sessions actives. `id` = sha256(token) : le jeton en clair n'est jamais stocke. */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		userAgent: text('user_agent'),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull()
	},
	(t) => ({
		userIdx: index('sessions_user_idx').on(t.userId)
	})
);

/** Jetons a usage unique des magic links. `id` = sha256(token). */
export const loginTokens = sqliteTable(
	'login_tokens',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull(),
		usedAt: integer('used_at')
	},
	(t) => ({
		userIdx: index('login_tokens_user_idx').on(t.userId)
	})
);

export const weeks = sqliteTable(
	'weeks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		season: integer('season').notNull(),
		/** 2 = saison reguliere, 3 = playoffs (convention ESPN) */
		seasontype: integer('seasontype').notNull(),
		number: integer('number').notNull(),
		label: text('label').notNull(),
		status: text('status', { enum: ['a_venir', 'ouverte', 'cloturee'] })
			.notNull()
			.default('a_venir'),
		snapshotAt: integer('snapshot_at'),
		closedAt: integer('closed_at'),
		winnerUserId: integer('winner_user_id').references(() => users.id),
		/**
		 * null = vraie semaine. Sinon la semaine est un bac a sable :
		 *   rejeu      = calendrier d'une saison passee, matchs deja finals ;
		 *   simulation = fixtures du client factice (MOCK_ESPN).
		 * Une semaine marquee sort du classement general et des stats joueur.
		 */
		testKind: text('test_kind', { enum: ['rejeu', 'simulation'] }),
		/** Coordonnees ESPN reellement interrogees par un rejeu (2025 / 2 / 1). */
		sourceSeason: integer('source_season'),
		sourceSeasontype: integer('source_seasontype'),
		sourceNumber: integer('source_number')
	},
	(t) => ({
		uniq: uniqueIndex('weeks_uidx').on(t.season, t.seasontype, t.number)
	})
);

export const games = sqliteTable(
	'games',
	{
		/** identifiant ESPN de l'evenement */
		id: text('id').primaryKey(),
		weekId: integer('week_id')
			.notNull()
			.references(() => weeks.id),
		homeTeamId: text('home_team_id'),
		homeAbbr: text('home_abbr').notNull(),
		homeName: text('home_name').notNull(),
		homeLogo: text('home_logo'),
		awayTeamId: text('away_team_id'),
		awayAbbr: text('away_abbr').notNull(),
		awayName: text('away_name').notNull(),
		awayLogo: text('away_logo'),
		kickoffUtc: integer('kickoff_utc').notNull(),
		/** scheduled | in | final | postponed | canceled */
		status: text('status').notNull().default('scheduled'),
		statusDetail: text('status_detail'),
		scoreHome: integer('score_home'),
		scoreAway: integer('score_away'),
		/** 1 = match neutralise (reporte/annule) : 0 point pour tous, exclu des stats */
		neutralized: integer('neutralized').notNull().default(0),
		/** 1 = score corrige a la main par un admin, le poll ne l'ecrase plus */
		manualOverride: integer('manual_override').notNull().default(0),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => ({
		weekIdx: index('games_week_idx').on(t.weekId),
		kickoffIdx: index('games_kickoff_idx').on(t.kickoffUtc)
	})
);

/**
 * Bareme fige du mercredi. Une seule ligne par match : une fois posee, elle
 * n'est jamais reecrite (sauf forcage explicite par un admin).
 */
export const oddsSnapshots = sqliteTable('odds_snapshots', {
	gameId: text('game_id')
		.primaryKey()
		.references(() => games.id),
	moneylineHome: integer('moneyline_home'),
	moneylineAway: integer('moneyline_away'),
	spread: real('spread'),
	overUnder: real('over_under'),
	pHome: real('p_home').notNull(),
	pAway: real('p_away').notNull(),
	basePointsHome: integer('base_points_home').notNull(),
	basePointsAway: integer('base_points_away').notNull(),
	/** 1 = cotes indisponibles, fallback p = 0.5 applique */
	fallback: integer('fallback').notNull().default(0),
	provider: text('provider'),
	/** reponse brute ESPN, pour audit du bareme */
	rawJson: text('raw_json'),
	capturedAt: integer('captured_at').notNull()
});

export const picks = sqliteTable(
	'picks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		gameId: text('game_id')
			.notNull()
			.references(() => games.id),
		/**
		 * Mode de saisie choisi par le joueur pour ce match :
		 *   'score'  -> `score_home_pred` / `score_away_pred` remplis, `margin_pred` vide ;
		 *   'margin' -> `margin_pred` rempli, les deux scores vides.
		 * Les pronostics d'avant la migration v3 sont tous en 'score'.
		 */
		mode: text('mode', { enum: ['score', 'margin'] })
			.notNull()
			.default('score'),
		/** cote choisi : 'home', 'away', ou null pour un nul predit (mode 'margin') */
		pickSide: text('pick_side', { enum: ['home', 'away'] }),
		scoreHomePred: integer('score_home_pred'),
		scoreAwayPred: integer('score_away_pred'),
		/** ecart absolu predit en mode 'margin' : >= 1 avec equipe, 0 pour un nul */
		marginPred: integer('margin_pred'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => ({
		uniq: uniqueIndex('picks_user_game_uidx').on(t.userId, t.gameId),
		gameIdx: index('picks_game_idx').on(t.gameId)
	})
);

export const scores = sqliteTable(
	'scores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		gameId: text('game_id')
			.notNull()
			.references(() => games.id),
		weekId: integer('week_id')
			.notNull()
			.references(() => weeks.id),
		points: integer('points').notNull(),
		basePoints: integer('base_points').notNull(),
		bonusPoints: integer('bonus_points').notNull().default(0),
		/** none | margin | exact | draw */
		bonusKind: text('bonus_kind').notNull().default('none'),
		multiplier: real('multiplier').notNull().default(1),
		correct: integer('correct').notNull().default(0),
		exactScore: integer('exact_score').notNull().default(0),
		exactMargin: integer('exact_margin').notNull().default(0),
		computedAt: integer('computed_at').notNull()
	},
	(t) => ({
		uniq: uniqueIndex('scores_user_game_uidx').on(t.userId, t.gameId),
		weekIdx: index('scores_week_idx').on(t.weekId),
		userIdx: index('scores_user_idx').on(t.userId)
	})
);

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: integer('updated_at').notNull()
});

/** Journal d'execution des taches planifiees, affiche dans l'admin. */
export const cronRuns = sqliteTable(
	'cron_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		startedAt: integer('started_at').notNull(),
		finishedAt: integer('finished_at'),
		/** running | ok | error */
		status: text('status').notNull(),
		message: text('message'),
		trigger: text('trigger').notNull().default('cron')
	},
	(t) => ({
		nameIdx: index('cron_runs_name_idx').on(t.name, t.startedAt)
	})
);

export type User = typeof users.$inferSelect;
export type Week = typeof weeks.$inferSelect;
export type Game = typeof games.$inferSelect;
export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type Pick = typeof picks.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
