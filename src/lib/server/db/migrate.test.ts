import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS, runMigrations } from './migrate';

/**
 * La base de production est deja en v1 : le chemin qui compte n'est pas la
 * creation d'une base vierge mais la montee de version d'une base peuplee.
 * Ces tests rejouent exactement ce chemin en memoire.
 */

/** Base arretee a la v1, comme celle qui tourne aujourd'hui sur le VPS. */
function baseEnV1(): Database.Database {
	const db = new Database(':memory:');
	for (const sql of MIGRATIONS[0]) db.exec(sql);
	db.pragma('user_version = 1');
	return db;
}

function colonnes(db: Database.Database, table: string): string[] {
	return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('runMigrations', () => {
	it('mene une base vierge a la derniere version', () => {
		const db = new Database(':memory:');
		expect(runMigrations(db)).toBe(MIGRATIONS.length);
		expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
		db.close();
	});

	it('ajoute les colonnes de semaine de test a une base v1 existante', () => {
		const db = baseEnV1();
		expect(colonnes(db, 'weeks')).not.toContain('test_kind');

		// Toutes les migrations posterieures a la v1, v2 comprise.
		expect(runMigrations(db)).toBe(MIGRATIONS.length - 1);

		const cols = colonnes(db, 'weeks');
		expect(cols).toContain('test_kind');
		expect(cols).toContain('source_season');
		expect(cols).toContain('source_seasontype');
		expect(cols).toContain('source_number');
		db.close();
	});

	it('laisse les semaines existantes en semaines reelles', () => {
		const db = baseEnV1();
		db.prepare(
			`INSERT INTO weeks (season, seasontype, number, label, status)
			 VALUES (2026, 2, 1, 'Semaine 1', 'cloturee')`
		).run();

		runMigrations(db);

		const ligne = db.prepare(`SELECT label, test_kind FROM weeks`).get() as {
			label: string;
			test_kind: string | null;
		};
		// Une semaine d'avant la migration ne doit jamais devenir une semaine de
		// test : elle sortirait du classement general sans que personne ne l'ait
		// demande.
		expect(ligne.test_kind).toBeNull();
		expect(ligne.label).toBe('Semaine 1');
		expect(
			(db.prepare(`SELECT COUNT(*) AS n FROM weeks WHERE test_kind IS NULL`).get() as { n: number }).n
		).toBe(1);
		db.close();
	});

	it('est idempotente : un second passage ne fait rien', () => {
		const db = baseEnV1();
		runMigrations(db);
		expect(runMigrations(db)).toBe(0);
		expect(runMigrations(db)).toBe(0);
		expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
		db.close();
	});

	it('ne perd pas les donnees en montant de version', () => {
		const db = baseEnV1();
		peuple(db);

		runMigrations(db);

		expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(1);
		expect((db.prepare(`SELECT COUNT(*) AS n FROM games`).get() as { n: number }).n).toBe(1);
		db.close();
	});
});

/** Une base v1 avec un joueur, une semaine, un match et un pronostic. */
function peuple(db: Database.Database): void {
	db.prepare(
		`INSERT INTO users (pseudo, email, created_at) VALUES ('Toni', 'toni@example.invalid', 1)`
	).run();
	db.prepare(
		`INSERT INTO weeks (season, seasontype, number, label, status)
		 VALUES (2026, 2, 1, 'Semaine 1', 'cloturee')`
	).run();
	db.prepare(
		`INSERT INTO games (id, week_id, home_abbr, home_name, away_abbr, away_name,
			kickoff_utc, status, updated_at)
		 VALUES ('401', 1, 'KC', 'Chiefs', 'LV', 'Raiders', 1, 'final', 1)`
	).run();
	db.prepare(
		`INSERT INTO picks (user_id, game_id, pick_side, score_home_pred, score_away_pred,
			created_at, updated_at)
		 VALUES (1, '401', 'home', 27, 20, 5, 6)`
	).run();
}

/**
 * La v3 reconstruit `picks` : c'est la seule migration qui recopie des donnees
 * existantes, donc celle ou une erreur couterait des pronostics.
 */
describe('v4 : un seul mode de saisie', () => {
	it('convertit les scores predits en vainqueur + ecart', () => {
		const db = baseEnV1();
		peuple(db); // un pronostic 27-20 sur les locaux
		runMigrations(db);

		// Les colonnes du mode score sont parties avec lui.
		const cols = colonnes(db, 'picks');
		expect(cols).not.toContain('mode');
		expect(cols).not.toContain('score_home_pred');
		expect(cols).not.toContain('score_away_pred');
		expect(cols).toContain('margin_pred');

		// 27-20 disait deja « locaux, +7 » : c'est exactement ce qui reste.
		expect(db.prepare(`SELECT * FROM picks`).get()).toMatchObject({
			id: 1,
			user_id: 1,
			game_id: '401',
			pick_side: 'home',
			margin_pred: 7,
			created_at: 5,
			updated_at: 6
		});
		db.close();
	});

	it('convertit un score de nul en nul predit, sans equipe', () => {
		const db = baseEnV1();
		peuple(db);
		// Un second pronostic, sur un nul 20-20 avec une equipe designee : le
		// mode score permettait de crediter cette equipe si le match ne finissait
		// pas nul, ce qui n'a plus d'equivalent.
		db.prepare(
			`INSERT INTO users (pseudo, email, created_at) VALUES ('Ana', 'ana@example.invalid', 1)`
		).run();
		db.prepare(
			`INSERT INTO picks (user_id, game_id, pick_side, score_home_pred, score_away_pred,
					created_at, updated_at)
			 VALUES (2, '401', 'home', 20, 20, 1, 1)`
		).run();

		runMigrations(db);

		const rows = db
			.prepare(`SELECT user_id, pick_side, margin_pred FROM picks ORDER BY user_id`)
			.all();
		expect(rows).toEqual([
			{ user_id: 1, pick_side: 'home', margin_pred: 7 },
			// Ecart 0 : aucune equipe ne peut rester designee.
			{ user_id: 2, pick_side: null, margin_pred: 0 }
		]);
		db.close();
	});

	it('accepte un ecart libre, quelle que soit sa valeur', () => {
		const db = baseEnV1();
		peuple(db);
		runMigrations(db);

		db.prepare(
			`INSERT INTO users (pseudo, email, created_at) VALUES ('Bo', 'bo@example.invalid', 1)`
		).run();
		db.prepare(
			`INSERT INTO picks (user_id, game_id, pick_side, margin_pred, created_at, updated_at)
			 VALUES (2, '401', 'away', 17, 1, 1)`
		).run();

		expect(
			db.prepare(`SELECT pick_side, margin_pred FROM picks WHERE user_id = 2`).get()
		).toEqual({ pick_side: 'away', margin_pred: 17 });
		db.close();
	});

	it('retire exact_score de la table des points', () => {
		const db = baseEnV1();
		peuple(db);
		runMigrations(db);

		const cols = colonnes(db, 'scores');
		expect(cols).not.toContain('exact_score');
		// L'ecart exact, lui, garde tout son sens.
		expect(cols).toContain('exact_margin');
		db.close();
	});

	it('garde un seul pronostic par joueur et par match', () => {
		const db = baseEnV1();
		peuple(db);
		runMigrations(db);

		// L'index unique doit avoir survecu aux deux DROP puis RENAME successifs.
		expect(() =>
			db
				.prepare(
					`INSERT INTO picks (user_id, game_id, margin_pred, created_at, updated_at)
					 VALUES (1, '401', 3, 1, 1)`
				)
				.run()
		).toThrow(/UNIQUE/);
		db.close();
	});

	it('laisse les cles etrangeres en place', () => {
		const db = baseEnV1();
		peuple(db);
		runMigrations(db);
		db.pragma('foreign_keys = ON');

		expect(() =>
			db
				.prepare(
					`INSERT INTO picks (user_id, game_id, margin_pred, created_at, updated_at)
					 VALUES (99, '401', 3, 1, 1)`
				)
				.run()
		).toThrow(/FOREIGN KEY/);
		expect((db.pragma('foreign_key_check') as unknown[]).length).toBe(0);
		db.close();
	});
});
