import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Export lisible de la saison.
 *
 * La propriete qui compte : **sommer la colonne « points » d'un joueur doit
 * redonner son total au classement**, ajustements compris. Un export ou les
 * corrections manquent raconte une autre saison que celle qui a ete jouee.
 */

let repertoire: string;

type Modules = {
	db: typeof import('./db');
	schema: typeof import('./db/schema');
	exporter: typeof import('./export');
	adjustments: typeof import('./adjustments');
	standings: typeof import('./standings');
	settings: typeof import('./settings');
};

let m: Modules;
let ana: number;
let bo: number;
let semaineId: number;

const MATCH = 'export-401900002';

beforeAll(async () => {
	repertoire = mkdtempSync(join(tmpdir(), 'nflprono-export-'));
	process.env.DATABASE_PATH = join(repertoire, 'test.db');
	process.env.CRON_ENABLED = '0';

	m = {
		db: await import('./db'),
		schema: await import('./db/schema'),
		exporter: await import('./export'),
		adjustments: await import('./adjustments'),
		standings: await import('./standings'),
		settings: await import('./settings')
	};

	m.settings.seedSettings();
	const saison = m.settings.currentSeason();

	const { db } = m.db;
	const { users, weeks, games, oddsSnapshots, picks, scores } = m.schema;

	const joueur = (pseudo: string) =>
		db
			.insert(users)
			.values({ pseudo, email: `${pseudo.toLowerCase()}@example.invalid`, createdAt: 0 })
			.returning({ id: users.id })
			.get().id;

	ana = joueur('Ana');
	bo = joueur('Bo');

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
		.values({ gameId: MATCH, pHome: 0.7, pAway: 0.3, basePointsHome: 36, basePointsAway: 83, capturedAt: 1 })
		.run();

	db.insert(picks)
		.values({ userId: ana, gameId: MATCH, pickSide: 'home', marginPred: 4, createdAt: 1, updatedAt: 1 })
		.run();

	db.insert(scores)
		.values({
			userId: ana,
			gameId: MATCH,
			weekId: semaineId,
			points: 72,
			basePoints: 36,
			bonusPoints: 36,
			bonusKind: 'exact',
			correct: 1,
			exactMargin: 1,
			computedAt: 1
		})
		.run();

	m.adjustments.setAdjustment({
		userId: bo,
		weekId: semaineId,
		points: 40,
		reason: 'Absent — moyenne des autres joueurs (Semaine 1)',
		createdBy: ana
	});
});

afterAll(() => {
	m?.db?.sqlite?.close();
	rmSync(repertoire, { recursive: true, force: true });
});

/** Somme de la colonne « points » du CSV pour un joueur donne. */
function totalCsv(csv: string, pseudo: string): number {
	return csv
		.split('\r\n')
		.slice(1)
		.filter((ligne) => ligne.split(';')[2] === pseudo)
		.reduce((somme, ligne) => somme + Number(ligne.split(';')[8] || 0), 0);
}

describe('exportCsv', () => {
	it('redonne le total du classement, ajustements compris', () => {
		const csv = m.exporter.exportCsv();
		const classement = m.standings.seasonStandings();

		for (const pseudo of ['Ana', 'Bo']) {
			const attendu = classement.find((r) => r.pseudo === pseudo)!.points;
			expect(totalCsv(csv, pseudo)).toBe(attendu);
		}
	});

	it('distingue un ajustement d’un pronostic et en donne le motif', () => {
		const lignes = m.exporter.exportCsv().split('\r\n');
		const ajustement = lignes.find((l) => l.startsWith('ajustement;'))!;

		expect(ajustement.split(';')[2]).toBe('Bo');
		// Colonne « match » vide : aucun match ne lui correspond.
		expect(ajustement.split(';')[3]).toBe('');
		expect(ajustement).toContain('Absent');
	});

	it('s’ouvre correctement dans un tableur francais', () => {
		const csv = m.exporter.exportCsv();
		// BOM en tete, sans quoi les accents partent en mojibake.
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv.split('\r\n')[0]).toContain('type;semaine;joueur');
	});

	it('echappe les valeurs contenant le separateur', () => {
		m.adjustments.setAdjustment({
			userId: bo,
			weekId: semaineId,
			points: 40,
			reason: 'Motif avec ; un point-virgule et "des guillemets"',
			createdBy: ana
		});

		const ligne = m.exporter
			.exportCsv()
			.split('\r\n')
			.find((l) => l.startsWith('ajustement;'))!;
		expect(ligne).toContain('"Motif avec ; un point-virgule et ""des guillemets"""');
		// Le champ echappe ne doit pas casser le decoupage des colonnes.
		expect(ligne.split(';')[2]).toBe('Bo');
	});
});

describe('exportJson', () => {
	it('contient la saison au complet, ajustements compris', () => {
		const dump = JSON.parse(m.exporter.exportJson());

		expect(dump.saison).toBe(m.settings.currentSeason());
		expect(dump.joueurs.map((j: { pseudo: string }) => j.pseudo)).toEqual(['Ana', 'Bo']);
		expect(dump.semaines).toHaveLength(1);
		expect(dump.matchs).toHaveLength(1);
		expect(dump.pronostics).toHaveLength(1);
		expect(dump.ajustements).toHaveLength(1);
		expect(dump.ajustements[0]).toMatchObject({ pseudo: 'Bo', points: 40 });
	});

	it('garde le bareme fige, qui explique les points', () => {
		const dump = JSON.parse(m.exporter.exportJson());
		expect(dump.matchs[0]).toMatchObject({ basePointsHome: 36, basePointsAway: 83, pHome: 0.7 });
	});
});
