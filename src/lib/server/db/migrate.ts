import type Database from 'better-sqlite3';

/**
 * Migration au demarrage, volontairement idempotente et sans dependance au CLI
 * drizzle-kit : le conteneur se suffit a lui-meme. Chaque migration est jouee
 * une seule fois et son numero est memorise dans `user_version`.
 */

export const MIGRATIONS: string[][] = [
	// --- v1 : schema initial ------------------------------------------------
	[
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pseudo TEXT NOT NULL,
			email TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'joueur',
			avatar TEXT,
			active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS users_pseudo_uidx ON users (pseudo)`,

		`CREATE TABLE IF NOT EXISTS invites (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL,
			email TEXT,
			note TEXT,
			expires_at INTEGER,
			used_by INTEGER REFERENCES users(id),
			used_at INTEGER,
			created_by INTEGER REFERENCES users(id),
			created_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS invites_code_uidx ON invites (code)`,

		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id),
			user_agent TEXT,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,

		`CREATE TABLE IF NOT EXISTS login_tokens (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id),
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			used_at INTEGER
		)`,
		`CREATE INDEX IF NOT EXISTS login_tokens_user_idx ON login_tokens (user_id)`,

		`CREATE TABLE IF NOT EXISTS weeks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			season INTEGER NOT NULL,
			seasontype INTEGER NOT NULL,
			number INTEGER NOT NULL,
			label TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'a_venir',
			snapshot_at INTEGER,
			closed_at INTEGER,
			winner_user_id INTEGER REFERENCES users(id)
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS weeks_uidx ON weeks (season, seasontype, number)`,

		`CREATE TABLE IF NOT EXISTS games (
			id TEXT PRIMARY KEY,
			week_id INTEGER NOT NULL REFERENCES weeks(id),
			home_team_id TEXT,
			home_abbr TEXT NOT NULL,
			home_name TEXT NOT NULL,
			home_logo TEXT,
			away_team_id TEXT,
			away_abbr TEXT NOT NULL,
			away_name TEXT NOT NULL,
			away_logo TEXT,
			kickoff_utc INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'scheduled',
			status_detail TEXT,
			score_home INTEGER,
			score_away INTEGER,
			neutralized INTEGER NOT NULL DEFAULT 0,
			manual_override INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS games_week_idx ON games (week_id)`,
		`CREATE INDEX IF NOT EXISTS games_kickoff_idx ON games (kickoff_utc)`,

		`CREATE TABLE IF NOT EXISTS odds_snapshots (
			game_id TEXT PRIMARY KEY REFERENCES games(id),
			moneyline_home INTEGER,
			moneyline_away INTEGER,
			spread REAL,
			over_under REAL,
			p_home REAL NOT NULL,
			p_away REAL NOT NULL,
			base_points_home INTEGER NOT NULL,
			base_points_away INTEGER NOT NULL,
			fallback INTEGER NOT NULL DEFAULT 0,
			provider TEXT,
			raw_json TEXT,
			captured_at INTEGER NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS picks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			game_id TEXT NOT NULL REFERENCES games(id),
			pick_side TEXT NOT NULL,
			score_home_pred INTEGER NOT NULL,
			score_away_pred INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_uidx ON picks (user_id, game_id)`,
		`CREATE INDEX IF NOT EXISTS picks_game_idx ON picks (game_id)`,

		`CREATE TABLE IF NOT EXISTS scores (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			game_id TEXT NOT NULL REFERENCES games(id),
			week_id INTEGER NOT NULL REFERENCES weeks(id),
			points INTEGER NOT NULL,
			base_points INTEGER NOT NULL,
			bonus_points INTEGER NOT NULL DEFAULT 0,
			bonus_kind TEXT NOT NULL DEFAULT 'none',
			multiplier REAL NOT NULL DEFAULT 1,
			correct INTEGER NOT NULL DEFAULT 0,
			exact_score INTEGER NOT NULL DEFAULT 0,
			exact_margin INTEGER NOT NULL DEFAULT 0,
			computed_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS scores_user_game_uidx ON scores (user_id, game_id)`,
		`CREATE INDEX IF NOT EXISTS scores_week_idx ON scores (week_id)`,
		`CREATE INDEX IF NOT EXISTS scores_user_idx ON scores (user_id)`,

		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS cron_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			started_at INTEGER NOT NULL,
			finished_at INTEGER,
			status TEXT NOT NULL,
			message TEXT,
			trigger TEXT NOT NULL DEFAULT 'cron'
		)`,
		`CREATE INDEX IF NOT EXISTS cron_runs_name_idx ON cron_runs (name, started_at)`
	],

	// --- v2 : semaines de test (rejeu historique et simulation) --------------
	// Nullable sans defaut : toutes les semaines existantes deviennent donc de
	// vraies semaines, ce qui est bien l'etat voulu apres migration.
	[
		`ALTER TABLE weeks ADD COLUMN test_kind TEXT`,
		`ALTER TABLE weeks ADD COLUMN source_season INTEGER`,
		`ALTER TABLE weeks ADD COLUMN source_seasontype INTEGER`,
		`ALTER TABLE weeks ADD COLUMN source_number INTEGER`
	],

	// --- v3 : deux modes de saisie (vainqueur + ecart, ou score) --------------
	// La table est reconstruite plutot qu'alteree : trois colonnes doivent
	// devenir nullables (les scores en mode « ecart », l'equipe pour un nul
	// predit), ce qu'ALTER TABLE ne sait pas faire en SQLite.
	//
	// Les pronostics existants sont tous des scores predits : ils passent en
	// mode 'score' avec leurs valeurs a l'identique, `margin_pred` reste vide
	// puisque l'ecart s'y deduit des scores. Aucune ligne n'est perdue, aucune
	// ne change de sens.
	//
	// `picks` n'est la table parente d'aucune autre : le DROP puis le RENAME ne
	// laissent donc aucune reference pendante, cles etrangeres activees.
	[
		`CREATE TABLE picks_v3 (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			game_id TEXT NOT NULL REFERENCES games(id),
			mode TEXT NOT NULL DEFAULT 'score',
			pick_side TEXT,
			score_home_pred INTEGER,
			score_away_pred INTEGER,
			margin_pred INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`INSERT INTO picks_v3 (id, user_id, game_id, mode, pick_side,
				score_home_pred, score_away_pred, margin_pred, created_at, updated_at)
			SELECT id, user_id, game_id, 'score', pick_side,
				score_home_pred, score_away_pred, NULL, created_at, updated_at
			FROM picks`,
		`DROP TABLE picks`,
		`ALTER TABLE picks_v3 RENAME TO picks`,
		`CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_uidx ON picks (user_id, game_id)`,
		`CREATE INDEX IF NOT EXISTS picks_game_idx ON picks (game_id)`
	]
];

export function runMigrations(db: Database.Database): number {
	const current = db.pragma('user_version', { simple: true }) as number;
	let applied = 0;

	for (let version = current; version < MIGRATIONS.length; version++) {
		const statements = MIGRATIONS[version];
		const tx = db.transaction(() => {
			for (const sql of statements) db.exec(sql);
			db.pragma(`user_version = ${version + 1}`);
		});
		tx();
		applied++;
	}

	return applied;
}
