import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Test d'integration sur une base jetable, autour de la question posee par le
 * galop d'essai d'aout : **la presaison compte-t-elle comme une vraie semaine,
 * et la remise a zero la fait-elle disparaitre sans emporter la saison ?**
 *
 * Les modules serveur ouvrent la base a l'import (`db/index.ts` resout
 * DATABASE_PATH au chargement) : les imports sont donc dynamiques et arrivent
 * apres l'affectation de la variable.
 */

let repertoire: string;

type Modules = {
	db: typeof import('./db');
	schema: typeof import('./db/schema');
	presaison: typeof import('./presaison');
	testing: typeof import('./testing');
	standings: typeof import('./standings');
	settings: typeof import('./settings');
	weeks: typeof import('./weeks');
};

let m: Modules;
let saison: number;
let joueurId: number;
let vraieSemaineId: number;
let presaisonSemaineId: number;

const VRAI_MATCH = 'reel-401700001';
const MATCH_PRESAISON = 'pre-401800001';

beforeAll(async () => {
	repertoire = mkdtempSync(join(tmpdir(), 'nflprono-presaison-'));
	process.env.DATABASE_PATH = join(repertoire, 'test.db');
	process.env.CRON_ENABLED = '0';

	m = {
		db: await import('./db'),
		schema: await import('./db/schema'),
		presaison: await import('./presaison'),
		testing: await import('./testing'),
		standings: await import('./standings'),
		settings: await import('./settings'),
		weeks: await import('./weeks')
	};

	m.settings.seedSettings();
	saison = m.settings.currentSeason();

	const { db } = m.db;
	const { users, weeks, games, oddsSnapshots, picks, scores } = m.schema;

	joueurId = db
		.insert(users)
		.values({ pseudo: 'Testeur', email: 'testeur@example.invalid', createdAt: 0 })
		.returning({ id: users.id })
		.get().id;

	vraieSemaineId = db
		.insert(weeks)
		.values({ season: saison, seasontype: 2, number: 1, label: 'Semaine 1', status: 'cloturee' })
		.returning({ id: weeks.id })
		.get().id;

	// La semaine de presaison passe par le chemin normal : c'est aussi ce qui
	// verifie que `weekLabel` la nomme autrement qu'une semaine reguliere.
	presaisonSemaineId = m.weeks.ensureWeek(saison, 1, 2).id;
	db.update(weeks).set({ status: 'cloturee' }).where(eq(weeks.id, presaisonSemaineId)).run();

	const match = (id: string, weekId: number) =>
		db
			.insert(games)
			.values({
				id,
				weekId,
				homeAbbr: 'KC',
				homeName: 'Kansas City Chiefs',
				awayAbbr: 'LV',
				awayName: 'Las Vegas Raiders',
				kickoffUtc: 1,
				status: 'final',
				scoreHome: 24,
				scoreAway: 20,
				updatedAt: 1
			})
			.run();

	match(VRAI_MATCH, vraieSemaineId);
	match(MATCH_PRESAISON, presaisonSemaineId);

	for (const gameId of [VRAI_MATCH, MATCH_PRESAISON]) {
		db.insert(oddsSnapshots)
			.values({ gameId, pHome: 0.7, pAway: 0.3, basePointsHome: 36, basePointsAway: 83, capturedAt: 1 })
			.run();
		db.insert(picks)
			.values({ userId: joueurId, gameId, pickSide: 'home', marginPred: 4, createdAt: 1, updatedAt: 1 })
			.run();
	}

	db.insert(scores)
		.values({
			userId: joueurId,
			gameId: VRAI_MATCH,
			weekId: vraieSemaineId,
			points: 100,
			basePoints: 100,
			correct: 1,
			computedAt: 1
		})
		.run();

	db.insert(scores)
		.values({
			userId: joueurId,
			gameId: MATCH_PRESAISON,
			weekId: presaisonSemaineId,
			points: 50,
			basePoints: 50,
			correct: 1,
			computedAt: 1
		})
		.run();
});

afterAll(() => {
	m?.db?.sqlite?.close();
	rmSync(repertoire, { recursive: true, force: true });
});

describe('semaine de presaison', () => {
	it('porte un libelle qui ne se confond pas avec la saison reguliere', () => {
		expect(m.weeks.getWeekById(presaisonSemaineId)?.label).toBe('Presaison - semaine 1');
	});

	it('compte au classement general, contrairement a une semaine de test', () => {
		const general = m.standings.seasonStandings().find((r) => r.userId === joueurId)!;
		expect(general.points).toBe(150);
		expect(general.played).toBe(2);

		expect(m.standings.playerStats(joueurId).points).toBe(150);
		expect(m.standings.playerHistory(joueurId)).toHaveLength(2);
	});

	it('passe apres les vraies semaines dans la liste des onglets', () => {
		// Tri par type decroissant : la saison reguliere (2) devant la presaison (1).
		expect(m.weeks.listVisibleWeeks().map((w) => w.id)).toEqual([
			vraieSemaineId,
			presaisonSemaineId
		]);
	});

	it('est inventoriee avec ce que la remise a zero emportera', () => {
		const inventaire = m.presaison.listPreseasonWeeks();
		expect(inventaire).toHaveLength(1);
		expect(inventaire[0].week.id).toBe(presaisonSemaineId);
		expect(inventaire[0]).toMatchObject({ games: 1, picks: 1, scores: 1 });
	});
});

describe('purgePreseasonWeeks', () => {
	it('supprime la presaison et tout ce qui en depend', () => {
		const rapport = m.presaison.purgePreseasonWeeks();
		expect(rapport).toMatchObject({ weeks: 1, games: 1, picks: 1, scores: 1, odds: 1 });
		expect(rapport.labels).toEqual(['Presaison - semaine 1']);
		expect(m.presaison.listPreseasonWeeks()).toEqual([]);
	});

	it('remet le classement general a la seule vraie semaine', () => {
		const general = m.standings.seasonStandings().find((r) => r.userId === joueurId)!;
		expect(general.points).toBe(100);
		expect(general.played).toBe(1);
		expect(m.standings.playerHistory(joueurId)).toHaveLength(1);
	});

	it("n'a pas touche a la vraie semaine ni aux joueurs", () => {
		const { sqlite } = m.db;
		const compte = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

		expect(compte(`SELECT COUNT(*) AS n FROM weeks`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM games`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM picks`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM scores`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM odds_snapshots`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM users`)).toBe(1);
		expect(m.weeks.getWeekById(vraieSemaineId)?.label).toBe('Semaine 1');
	});

	it('ne laisse aucune ligne orpheline et est idempotente', () => {
		expect(m.testing.orphelins()).toEqual({ games: 0, picks: 0, scores: 0, odds: 0 });
		expect(m.presaison.purgePreseasonWeeks()).toEqual({
			weeks: 0,
			games: 0,
			picks: 0,
			scores: 0,
			odds: 0,
			labels: []
		});
	});
});
