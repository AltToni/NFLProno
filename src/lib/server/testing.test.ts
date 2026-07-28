import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Test d'integration sur une base jetable. Il repond a la question posee au
 * moment d'ouvrir le jeu aux donnees de test : **est-ce qu'une purge nettoie
 * vraiment tout, sans emporter la vraie saison ?**
 *
 * Les modules serveur ouvrent la base a l'import (`db/index.ts` resout
 * DATABASE_PATH au chargement). Les imports sont donc dynamiques et arrivent
 * apres l'affectation de la variable, sinon le test ecrirait dans la base de
 * developpement.
 */

let repertoire: string;

type Modules = {
	db: typeof import('./db');
	schema: typeof import('./db/schema');
	testing: typeof import('./testing');
	picks: typeof import('./picks');
	results: typeof import('./results');
	standings: typeof import('./standings');
	settings: typeof import('./settings');
	weeks: typeof import('./weeks');
	health: typeof import('./health');
	espnMock: typeof import('./espn-mock');
	sync: typeof import('./sync');
};

let m: Modules;
let saison: number;
let joueurId: number;
let vraieSemaineId: number;

const VRAI_MATCH = 'reel-401700001';

beforeAll(async () => {
	repertoire = mkdtempSync(join(tmpdir(), 'nflprono-test-'));
	process.env.DATABASE_PATH = join(repertoire, 'test.db');
	process.env.MOCK_ESPN = '1';
	process.env.CRON_ENABLED = '0';

	m = {
		db: await import('./db'),
		schema: await import('./db/schema'),
		testing: await import('./testing'),
		picks: await import('./picks'),
		results: await import('./results'),
		standings: await import('./standings'),
		settings: await import('./settings'),
		weeks: await import('./weeks'),
		health: await import('./health'),
		espnMock: await import('./espn-mock'),
		sync: await import('./sync')
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

	// Une vraie semaine complete, avec tout ce que la purge pourrait emporter
	// par erreur : match, bareme fige, pronostic et ligne de points.
	vraieSemaineId = db
		.insert(weeks)
		.values({
			season: saison,
			seasontype: 2,
			number: 1,
			label: 'Semaine 1',
			status: 'cloturee'
		})
		.returning({ id: weeks.id })
		.get().id;

	db.insert(games)
		.values({
			id: VRAI_MATCH,
			weekId: vraieSemaineId,
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

	db.insert(oddsSnapshots)
		.values({
			gameId: VRAI_MATCH,
			pHome: 0.7,
			pAway: 0.3,
			basePointsHome: 36,
			basePointsAway: 83,
			capturedAt: 1
		})
		.run();

	db.insert(picks)
		.values({
			userId: joueurId,
			gameId: VRAI_MATCH,
			pickSide: 'home',
			scoreHomePred: 24,
			scoreAwayPred: 20,
			createdAt: 1,
			updatedAt: 1
		})
		.run();

	db.insert(scores)
		.values({
			userId: joueurId,
			gameId: VRAI_MATCH,
			weekId: vraieSemaineId,
			points: 100,
			basePoints: 100,
			computedAt: 1
		})
		.run();
});

afterAll(() => {
	m?.db?.sqlite?.close();
	rmSync(repertoire, { recursive: true, force: true });
});

describe('createReplayWeek : garde-fous', () => {
	/** Validation pure, avant tout appel reseau : aucun test ne sort de la machine. */
	it('refuse une saison qui n\'est pas passee', async () => {
		await expect(m.testing.createReplayWeek({ year: saison, seasontype: 2, week: 1 })).rejects.toThrow(
			/anterieure/
		);
		await expect(
			m.testing.createReplayWeek({ year: saison + 1, seasontype: 2, week: 1 })
		).rejects.toThrow(/anterieure/);
	});

	it('refuse un type de saison hors reguliere et playoffs', async () => {
		await expect(
			m.testing.createReplayWeek({ year: saison - 1, seasontype: 1, week: 1 })
		).rejects.toThrow(/Type de saison invalide/);
	});
});

describe('semaine de simulation', () => {
	let semaineId: number;

	it('se cree avec quatre matchs a venir et leur bareme fige', () => {
		const result = m.testing.createSimulationWeek();
		semaineId = result.weekId;

		expect(result.games).toBe(4);
		expect(result.snapshots).toBe(4);
		// Des cotes fictives exploitables : aucun repli 50/50.
		expect(result.fallbacks).toEqual([]);
		expect(result.label).toContain('TEST');

		const board = m.picks.weekBoard(semaineId, joueurId);
		expect(board).toHaveLength(4);
		expect(board.every((g) => !g.locked)).toBe(true);
		expect(board.every((g) => g.basePointsHome !== null)).toBe(true);
	});

	it('occupe un numero hors du calendrier reel', () => {
		const semaine = m.weeks.getWeekById(semaineId)!;
		expect(semaine.number).toBeGreaterThanOrEqual(90);
		expect(semaine.testKind).toBe('simulation');
		expect(semaine.season).toBe(saison);
	});

	it('passe apres les vraies semaines dans la liste des onglets', () => {
		// Son numero reserve (90+) la placerait en tete du tri par numero
		// decroissant : le tri remet les vraies semaines devant.
		expect(m.weeks.listVisibleWeeks().map((w) => w.id)).toEqual([vraieSemaineId, semaineId]);
	});

	it("n'est jamais la semaine affichee par defaut", () => {
		// La vraie semaine 1 est cloturee, la simulation est ouverte : sans
		// exclusion, c'est elle que verraient les joueurs en arrivant.
		expect(m.weeks.currentWeek()?.id).toBe(vraieSemaineId);
	});

	it("ne fausse pas l'etat du systeme", () => {
		const etat = m.health.etatSysteme();

		// Le seul vrai match date de 1970 : on est hors saison, et les kickoffs
		// a cinq minutes de la simulation ne doivent pas dire le contraire.
		expect(etat.enSaison).toBe(false);

		// Les cotes fraiches de la simulation ne doivent pas se faire passer pour
		// le dernier snapshot reel, sinon un snapshot manquant depuis des
		// semaines passerait au vert.
		const snapshot = etat.indicateurs.find((i) => i.cle === 'snapshot')!;
		expect(snapshot.horodatage).toBe(1);
		expect(snapshot.detail).toBe('aucune semaine ouverte');
	});

	it('accepte les pronostics avant le kickoff', () => {
		for (const game of m.picks.weekBoard(semaineId, joueurId)) {
			m.picks.savePick({
				userId: joueurId,
				gameId: game.id,
				pickSide: 'home',
				scoreHomePred: 21,
				scoreAwayPred: 17
			});
		}
		expect(m.picks.weekBoard(semaineId, joueurId).every((g) => g.pick !== null)).toBe(true);
	});

	it('verrouille des le kickoff, avant meme la fin du match', () => {
		const { db } = m.db;
		const { games } = m.schema;

		const stored = db
			.select({ id: games.id, kickoffUtc: games.kickoffUtc })
			.from(games)
			.where(eq(games.weekId, semaineId))
			.all()
			.sort((a, b) => a.kickoffUtc - b.kickoffUtc);

		// Le verrouillage se lit sur l'horloge, pas sur le statut du match : on
		// avance donc reellement le temps plutot que de forcer les statuts. Une
		// seconde apres le premier kickoff, ce match seul doit etre ferme.
		vi.useFakeTimers();
		try {
			vi.setSystemTime((stored[0].kickoffUtc + 1) * 1000);

			expect(() =>
				m.picks.savePick({
					userId: joueurId,
					gameId: stored[0].id,
					pickSide: 'away',
					scoreHomePred: 10,
					scoreAwayPred: 30
				})
			).toThrow(/verrouille/);

			// Le dernier match, lui, n'a pas commence : il reste modifiable.
			expect(() =>
				m.picks.savePick({
					userId: joueurId,
					gameId: stored[3].id,
					pickSide: 'away',
					scoreHomePred: 10,
					scoreAwayPred: 30
				})
			).not.toThrow();

			const board = m.picks.weekBoard(semaineId, joueurId);
			expect(board.filter((g) => g.locked)).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('calcule les points au passage en final', () => {
		const { db } = m.db;
		const { games } = m.schema;

		const stored = db
			.select({ id: games.id, kickoffUtc: games.kickoffUtc })
			.from(games)
			.where(eq(games.weekId, semaineId))
			.all();

		vi.useFakeTimers();
		try {
			// Trente minutes apres la creation, les quatre matchs sont finals. On
			// passe par le vrai chemin du poll, pas par un UPDATE a la main.
			vi.setSystemTime((stored[stored.length - 1].kickoffUtc + m.espnMock.DUREE_MATCH_S) * 1000);
			const avances = m.espnMock.mockPollGames(stored, Math.floor(Date.now() / 1000));
			expect(avances.every((g) => g.status === 'final')).toBe(true);
			m.sync.upsertGames(semaineId, avances);

			const rapport = m.results.computeWeekScores(semaineId);
			expect(rapport.gamesScored).toBe(4);
			expect(rapport.picksScored).toBe(4);
			expect(rapport.missingSnapshots).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('apparait au classement hebdomadaire mais pas au general', () => {
		const hebdo = m.standings.weekStandings(semaineId).find((r) => r.userId === joueurId)!;
		expect(hebdo.played).toBe(4);
		expect(hebdo.points).toBeGreaterThan(0);

		// Le classement general ne connait que les 100 points de la vraie semaine.
		const general = m.standings.seasonStandings().find((r) => r.userId === joueurId)!;
		expect(general.points).toBe(100);
		expect(general.played).toBe(1);

		// Idem pour les stats et l'historique du profil joueur.
		expect(m.standings.playerStats(joueurId).points).toBe(100);
		expect(m.standings.playerHistory(joueurId)).toHaveLength(1);

		// Et pour le graphe d'evolution.
		expect(m.standings.rankEvolution().weeks.map((w) => w.id)).toEqual([vraieSemaineId]);
	});
});

describe('purgeTestWeeks', () => {
	it('supprime la semaine de test et tout ce qui en depend', () => {
		const avant = m.testing.listTestWeeks();
		expect(avant).toHaveLength(1);
		expect(avant[0].games).toBe(4);
		expect(avant[0].picks).toBe(4);
		expect(avant[0].scores).toBe(4);

		const rapport = m.testing.purgeTestWeeks();
		expect(rapport.weeks).toBe(1);
		expect(rapport.games).toBe(4);
		expect(rapport.picks).toBe(4);
		expect(rapport.scores).toBe(4);
		expect(rapport.odds).toBe(4);

		expect(m.testing.listTestWeeks()).toEqual([]);
	});

	it('ne laisse aucune ligne orpheline', () => {
		expect(m.testing.orphelins()).toEqual({ games: 0, picks: 0, scores: 0, odds: 0 });
	});

	it('ne laisse aucune trace des fixtures dans les tables', () => {
		const { sqlite } = m.db;
		const compte = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

		expect(compte(`SELECT COUNT(*) AS n FROM games WHERE id LIKE 'TEST-SIM-%'`)).toBe(0);
		expect(compte(`SELECT COUNT(*) AS n FROM odds_snapshots WHERE game_id LIKE 'TEST-SIM-%'`)).toBe(0);
		expect(compte(`SELECT COUNT(*) AS n FROM picks WHERE game_id LIKE 'TEST-SIM-%'`)).toBe(0);
		expect(compte(`SELECT COUNT(*) AS n FROM scores WHERE game_id LIKE 'TEST-SIM-%'`)).toBe(0);
		expect(compte(`SELECT COUNT(*) AS n FROM weeks WHERE test_kind IS NOT NULL`)).toBe(0);
	});

	it("n'a pas touche a la vraie semaine", () => {
		const { sqlite } = m.db;
		const compte = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;

		expect(compte(`SELECT COUNT(*) AS n FROM weeks`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM games`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM picks`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM scores`)).toBe(1);
		expect(compte(`SELECT COUNT(*) AS n FROM odds_snapshots`)).toBe(1);
		// Le joueur et son historique reel sont intacts.
		expect(m.standings.seasonStandings().find((r) => r.userId === joueurId)!.points).toBe(100);
		expect(m.weeks.getWeekById(vraieSemaineId)?.label).toBe('Semaine 1');
	});

	it('est idempotente', () => {
		expect(m.testing.purgeTestWeeks()).toEqual({
			weeks: 0,
			games: 0,
			picks: 0,
			scores: 0,
			odds: 0,
			labels: []
		});
		expect(m.testing.orphelins()).toEqual({ games: 0, picks: 0, scores: 0, odds: 0 });
	});

	it('libere le numero pour une nouvelle semaine de test', () => {
		const encore = m.testing.createSimulationWeek();
		expect(m.weeks.getWeekById(encore.weekId)?.number).toBe(90);
		m.testing.purgeTestWeeks();
	});
});
