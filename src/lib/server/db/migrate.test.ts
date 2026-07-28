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

		expect(runMigrations(db)).toBe(1);

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

		runMigrations(db);

		expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(1);
		expect((db.prepare(`SELECT COUNT(*) AS n FROM games`).get() as { n: number }).n).toBe(1);
		db.close();
	});
});
