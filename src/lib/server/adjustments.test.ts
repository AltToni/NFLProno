import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Test d'integration sur une base jetable, autour de la question qui a fait
 * naitre la table : **un joueur absent une journee peut-il recevoir la moyenne
 * des autres, et cette correction survit-elle au recalcul des points ?**
 *
 * Le second point est le vrai enjeu. `scores` est reecrit de zero a chaque
 * passage du poll ; une correction ecrite dedans aurait disparu sans bruit, et
 * personne ne l'aurait remarque avant le classement final.
 *
 * Les modules serveur ouvrent la base a l'import : les imports sont donc
 * dynamiques et arrivent apres l'affectation de DATABASE_PATH.
 */

let repertoire: string;

type Modules = {
	db: typeof import('./db');
	schema: typeof import('./db/schema');
	adjustments: typeof import('./adjustments');
	standings: typeof import('./standings');
	results: typeof import('./results');
	settings: typeof import('./settings');
	presaison: typeof import('./presaison');
	purge: typeof import('./purge');
	weeks: typeof import('./weeks');
};

let m: Modules;
let saison: number;
let ana: number;
let bo: number;
let cy: number;
let dee: number;
let semaineId: number;

const MATCH = 'ajust-401900001';

beforeAll(async () => {
	repertoire = mkdtempSync(join(tmpdir(), 'nflprono-ajustements-'));
	process.env.DATABASE_PATH = join(repertoire, 'test.db');
	process.env.CRON_ENABLED = '0';

	m = {
		db: await import('./db'),
		schema: await import('./db/schema'),
		adjustments: await import('./adjustments'),
		standings: await import('./standings'),
		results: await import('./results'),
		settings: await import('./settings'),
		presaison: await import('./presaison'),
		purge: await import('./purge'),
		weeks: await import('./weeks')
	};

	m.settings.seedSettings();
	saison = m.settings.currentSeason();

	const { db } = m.db;
	const { users, weeks, games, oddsSnapshots, picks, scores } = m.schema;

	const joueur = (pseudo: string, active = 1) =>
		db
			.insert(users)
			.values({
				pseudo,
				email: `${pseudo.toLowerCase()}@example.invalid`,
				active,
				createdAt: 0
			})
			.returning({ id: users.id })
			.get().id;

	ana = joueur('Ana');
	bo = joueur('Bo');
	cy = joueur('Cy'); // l'absent de la journee 1
	dee = joueur('Dee', 0); // compte desactive : hors classement et hors moyenne

	semaineId = db
		.insert(weeks)
		.values({ season: saison, seasontype: 2, number: 1, label: 'Semaine 1', status: 'cloturee' })
		.returning({ id: weeks.id })
		.get().id;

	db.insert(games)
		.values({
			id: MATCH,
			weekId: semaineId,
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
			gameId: MATCH,
			pHome: 0.7,
			pAway: 0.3,
			basePointsHome: 36,
			basePointsAway: 83,
			capturedAt: 1
		})
		.run();

	for (const userId of [ana, bo, dee]) {
		db.insert(picks)
			.values({ userId, gameId: MATCH, pickSide: 'home', marginPred: 4, createdAt: 1, updatedAt: 1 })
			.run();
	}

	// Points poses a la main : des valeurs rondes rendent la moyenne lisible.
	// Le recalcul reel est eprouve plus bas, dans son propre bloc.
	const point = (userId: number, points: number) =>
		db
			.insert(scores)
			.values({
				userId,
				gameId: MATCH,
				weekId: semaineId,
				points,
				basePoints: points,
				correct: 1,
				exactMargin: 1,
				computedAt: 1
			})
			.run();

	point(ana, 100);
	point(bo, 50);
	point(dee, 1000); // desactive : ne doit peser sur rien
});

afterAll(() => {
	m?.db?.sqlite?.close();
	rmSync(repertoire, { recursive: true, force: true });
});

describe('weekAverageWithout', () => {
	it('moyenne les autres joueurs actifs ayant joue', () => {
		expect(m.adjustments.weekAverageWithout(semaineId, cy)).toEqual({
			points: 75,
			players: 2,
			total: 150
		});
	});

	it('ignore les comptes desactives', () => {
		// Dee a 1000 points : s'il entrait dans le calcul, la moyenne serait 383.
		expect(m.adjustments.weekAverageWithout(semaineId, cy)!.points).toBe(75);
	});

	it("n'inclut pas le joueur qu'on compense", () => {
		// Vu depuis Ana, il ne reste que Bo.
		expect(m.adjustments.weekAverageWithout(semaineId, ana)).toEqual({
			points: 50,
			players: 1,
			total: 50
		});
	});

	it('ne compte pas un autre absent comme un zero', () => {
		// Cy n'a aucune ligne de points : il est absent du calcul, pas present a
		// zero. Sinon compenser deux absents ecraserait la moyenne des deux.
		expect(m.adjustments.weekAverageWithout(semaineId, bo)!.players).toBe(1);
	});

	it('renvoie null quand personne n’a joue', () => {
		const vide = m.weeks.ensureWeek(saison, 2, 18).id;
		expect(m.adjustments.weekAverageWithout(vide, cy)).toBeNull();
	});
});

describe('setAdjustment', () => {
	it('exige un motif : un ajustement muet serait une triche', () => {
		expect(() =>
			m.adjustments.setAdjustment({
				userId: cy,
				weekId: semaineId,
				points: 75,
				reason: '   ',
				createdBy: ana
			})
		).toThrow(/motif/);
	});

	it('cree la compensation et la fait entrer dans le classement general', () => {
		m.adjustments.setAdjustment({
			userId: cy,
			weekId: semaineId,
			points: 75,
			reason: 'Absent — moyenne des autres joueurs (Semaine 1)',
			createdBy: ana
		});

		const general = m.standings.seasonStandings();
		expect(general.map((r) => [r.pseudo, r.points, r.rank])).toEqual([
			['Ana', 100, 1],
			['Cy', 75, 2],
			['Bo', 50, 3]
		]);

		const compense = general.find((r) => r.userId === cy)!;
		expect(compense.adjustment).toBe(75);
	});

	it("ne gonfle ni la reussite ni les points par match de l'absent", () => {
		const compense = m.standings.seasonStandings().find((r) => r.userId === cy)!;
		// Cy n'a pronostique aucun match : ses statistiques de performance
		// doivent rester vides, meme s'il a des points.
		expect(compense.played).toBe(0);
		expect(compense.corrects).toBe(0);
		expect(compense.successRate).toBe(0);
		expect(compense.averagePoints).toBe(0);
	});

	it('laisse les statistiques des autres joueurs intactes', () => {
		const joueuse = m.standings.seasonStandings().find((r) => r.userId === ana)!;
		expect(joueuse).toMatchObject({ points: 100, adjustment: 0, played: 1, averagePoints: 100 });
	});

	it('compte aussi dans le classement de la semaine', () => {
		const semaine = m.standings.weekStandings(semaineId).find((r) => r.userId === cy)!;
		expect(semaine.points).toBe(75);
		expect(semaine.adjustment).toBe(75);
	});

	it('apparait dans les statistiques du joueur, distingue du calcule', () => {
		const stats = m.standings.playerStats(cy);
		expect(stats.points).toBe(75);
		expect(stats.adjustmentPoints).toBe(75);
		expect(stats.played).toBe(0);
		expect(stats.averagePoints).toBe(0);
	});

	it('entre dans le graphe d’evolution, sans quoi la courbe contredirait le classement', () => {
		const evolution = m.standings.rankEvolution();
		const serie = evolution.series.find((s) => s.userId === cy)!;
		expect(serie.points).toHaveLength(1);
		expect(serie.points[0]).toMatchObject({ points: 75, cumulative: 75, rank: 2 });
	});

	it('remplace au lieu d’empiler quand on reprend la meme semaine', () => {
		m.adjustments.setAdjustment({
			userId: cy,
			weekId: semaineId,
			points: 60,
			reason: 'Correction apres verification',
			createdBy: ana
		});

		const lignes = m.adjustments.listAdjustments();
		expect(lignes).toHaveLength(1);
		expect(lignes[0]).toMatchObject({ points: 60, reason: 'Correction apres verification' });
		expect(m.standings.seasonStandings().find((r) => r.userId === cy)!.points).toBe(60);

		// Remise a la valeur voulue pour la suite du fichier.
		m.adjustments.setAdjustment({
			userId: cy,
			weekId: semaineId,
			points: 75,
			reason: 'Absent — moyenne des autres joueurs (Semaine 1)',
			createdBy: ana
		});
	});

	it('accepte une correction negative', () => {
		m.adjustments.setAdjustment({
			userId: bo,
			weekId: semaineId,
			points: -10,
			reason: 'Penalite',
			createdBy: ana
		});
		expect(m.standings.seasonStandings().find((r) => r.userId === bo)!.points).toBe(40);

		m.adjustments.deleteAdjustment(m.adjustments.listAdjustments().find((a) => a.userId === bo)!.id);
		expect(m.standings.seasonStandings().find((r) => r.userId === bo)!.points).toBe(50);
	});
});

describe('resistance au recalcul', () => {
	it('survit a un recalcul complet de la saison', () => {
		// C'est tout l'interet de la table : le recalcul vide `scores` et le
		// reecrit depuis les pronostics. Les points calcules changent donc de
		// valeur ici — l'ajustement, lui, ne bouge pas d'un point.
		const rapport = m.results.recomputeSeason();
		expect(rapport.gamesScored).toBe(1);

		expect(m.adjustments.listAdjustments()).toHaveLength(1);
		const compense = m.standings.seasonStandings().find((r) => r.userId === cy)!;
		expect(compense.adjustment).toBe(75);
		expect(compense.points).toBe(75);
	});

	it('la moyenne se recalcule sur les nouveaux points, sans se nourrir d’elle-meme', () => {
		const semaine = m.standings.weekStandings(semaineId);
		const pointsAna = semaine.find((r) => r.userId === ana)!.points;
		const pointsBo = semaine.find((r) => r.userId === bo)!.points;

		// Ana et Bo ont le meme pronostic, donc les memes points : la moyenne des
		// deux vaut exactement ce que chacun a marque.
		expect(pointsAna).toBe(pointsBo);

		const moyenne = m.adjustments.weekAverageWithout(semaineId, cy)!;
		expect(moyenne.players).toBe(2);
		expect(moyenne.points).toBe(pointsAna);
		// Les 75 points deja accordes a Cy n'entrent pas dans le calcul : sinon
		// compenser un second absent ferait boule de neige.
		expect(moyenne.total).toBe(pointsAna + pointsBo);
	});
});

describe('purge d’une semaine', () => {
	it('emporte les ajustements qui la visaient', () => {
		// Une semaine de presaison, pour emprunter le chemin de purge reel.
		const presaisonId = m.weeks.ensureWeek(saison, 1, 2).id;
		m.adjustments.setAdjustment({
			userId: cy,
			weekId: presaisonId,
			points: 30,
			reason: 'Galop d’essai manque',
			createdBy: ana
		});
		expect(m.adjustments.listAdjustments()).toHaveLength(2);

		const rapport = m.presaison.purgePreseasonWeeks();
		expect(rapport.adjustments).toBe(1);

		// L'ajustement de la vraie semaine, lui, est toujours la.
		const restants = m.adjustments.listAdjustments();
		expect(restants).toHaveLength(1);
		expect(restants[0].weekId).toBe(semaineId);
	});

	it('ne laisse aucun ajustement orphelin', () => {
		expect(m.presaison.purgePreseasonWeeks().adjustments).toBe(0);
		expect(m.purge.orphelins().adjustments).toBe(0);
	});
});

describe('deleteAdjustment', () => {
	it('retire la ligne et rend son total au joueur', () => {
		const ligne = m.adjustments.listAdjustments()[0];
		expect(m.adjustments.deleteAdjustment(ligne.id)).toMatchObject({ pseudo: 'Cy', points: 75 });

		expect(m.adjustments.listAdjustments()).toEqual([]);
		expect(m.standings.seasonStandings().find((r) => r.userId === cy)!.points).toBe(0);
	});

	it('signale une ligne inexistante au lieu de faire semblant', () => {
		expect(m.adjustments.deleteAdjustment(99999)).toBeNull();
	});
});
