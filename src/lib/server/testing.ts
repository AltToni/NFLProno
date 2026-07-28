import { and, eq, isNotNull } from 'drizzle-orm';
import { db, sqlite } from './db';
import { weeks } from './db/schema';
import { enrichOdds, getScoreboard } from './espn';
import { FIXTURES, mockCreateGames, mockEnabled } from './espn-mock';
import { upsertGames, writeSnapshots } from './sync';
import { currentSeason } from './settings';
import { SEASONTYPE_PLAYOFFS, SEASONTYPE_REGULAR, TEST_LABEL_PREFIX, weekShortLabel } from '$lib/nfl';
import { logger } from './logger';
import { now } from '$lib/time';
import type { Week } from './db/schema';

/**
 * Semaines de test : deux facons d'exercer le cycle complet sans attendre un
 * vrai dimanche de septembre.
 *
 *  - **rejeu** : le calendrier d'une saison passee (2025) rejoue tel quel.
 *    Les matchs sont deja finals, les cotes historiques viennent de la core
 *    API. Le verrouillage au kickoff est neutralise pour cette semaine
 *    uniquement, sinon aucun pronostic ne serait saisissable.
 *  - **simulation** : les fixtures du client factice, avec de vrais kickoffs a
 *    quelques minutes. Le verrouillage, lui, s'applique normalement : c'est
 *    precisement ce qu'on veut voir se declencher.
 *
 * Deux invariants tiennent l'isolement vis-a-vis d'une vraie saison :
 *
 *  1. la semaine porte `test_kind`, ce qui la sort du classement general, des
 *     stats joueur et de la selection par defaut ;
 *  2. elle occupe un numero reserve (90-99), hors d'atteinte du calendrier
 *     reel (18 semaines regulieres, 5 tours de playoffs), et `runSnapshot`
 *     refuse d'ecrire sur un numero deja pris par une semaine de test.
 */

/**
 * Les semaines de test vivent dans la saison courante — c'est la condition
 * pour qu'elles apparaissent dans l'interface, toutes les vues filtrant sur
 * `currentSeason()`. La saison rejouee est conservee a part, dans
 * `source_season`.
 */
const PREMIER_NUMERO = 90;
const DERNIER_NUMERO = 99;

function numeroLibre(season: number): number {
	const pris = new Set(
		db
			.select({ number: weeks.number })
			.from(weeks)
			.where(and(eq(weeks.season, season), eq(weeks.seasontype, SEASONTYPE_REGULAR)))
			.all()
			.map((r) => r.number)
	);
	for (let n = PREMIER_NUMERO; n <= DERNIER_NUMERO; n++) {
		if (!pris.has(n)) return n;
	}
	throw new Error(
		`Les ${DERNIER_NUMERO - PREMIER_NUMERO + 1} numeros reserves aux semaines de test sont pris. ` +
			`Lance la purge avant d'en creer une nouvelle.`
	);
}

export interface TestWeekResult {
	weekId: number;
	label: string;
	games: number;
	snapshots: number;
	fallbacks: string[];
}

// ---------------------------------------------------------------------------
// Rejeu d'une saison passee
// ---------------------------------------------------------------------------

export interface ReplayInput {
	/** Saison ESPN a rejouer, strictement anterieure a la saison courante. */
	year: number;
	seasontype: number;
	week: number;
}

export async function createReplayWeek(input: ReplayInput): Promise<TestWeekResult> {
	const season = currentSeason();
	const { year, seasontype, week } = input;

	if (!Number.isInteger(year) || year < 2000 || year >= season) {
		throw new Error(
			`Annee invalide : ${year}. Le rejeu porte sur une saison passee, donc strictement ` +
				`anterieure a ${season}.`
		);
	}
	if (seasontype !== SEASONTYPE_REGULAR && seasontype !== SEASONTYPE_PLAYOFFS) {
		throw new Error(`Type de saison invalide : ${seasontype}. Attendu 2 (reguliere) ou 3 (playoffs).`);
	}
	if (!Number.isInteger(week) || week < 1 || week > 22) {
		throw new Error(`Numero de semaine invalide : ${week}.`);
	}

	// Rejouer deux fois la meme source ferait migrer les matchs de la premiere
	// semaine vers la seconde (`games.id` est l'identifiant ESPN, unique), la
	// laissant vide avec ses pronostics orphelins de tout match.
	const deja = db
		.select({ label: weeks.label })
		.from(weeks)
		.where(
			and(
				eq(weeks.sourceSeason, year),
				eq(weeks.sourceSeasontype, seasontype),
				eq(weeks.sourceNumber, week)
			)
		)
		.get();
	if (deja) {
		throw new Error(
			`${year} / type ${seasontype} / semaine ${week} est deja rejouee par « ${deja.label} ». ` +
				`Purge les semaines de test avant de recommencer.`
		);
	}

	const { parsed } = await getScoreboard(year, seasontype, week);
	if (parsed.games.length === 0) {
		throw new Error(`Aucun match renvoye par ESPN pour ${year} / type ${seasontype} / semaine ${week}`);
	}

	// ESPN retire `odds[]` du scoreboard des qu'un match est termine : sur une
	// saison passee, *tous* les matchs sont dans ce cas. Les cotes historiques
	// viennent donc systematiquement du repli sur la core API, qui, lui, les
	// conserve. Sans cet appel, le rejeu figerait un bareme 50/50 partout et ne
	// testerait plus rien du calcul des points.
	const enriched = await enrichOdds(parsed.games);

	const numero = numeroLibre(season);
	const label = `${TEST_LABEL_PREFIX} · Rejeu ${year} ${weekShortLabel(seasontype, week)}`;
	const ts = now();

	const result = db.transaction(() => {
		const weekId = db
			.insert(weeks)
			.values({
				season,
				seasontype: SEASONTYPE_REGULAR,
				number: numero,
				label,
				status: 'ouverte',
				snapshotAt: ts,
				testKind: 'rejeu',
				sourceSeason: year,
				sourceSeasontype: seasontype,
				sourceNumber: week
			})
			.returning({ id: weeks.id })
			.get().id;

		const gamesUpserted = upsertGames(weekId, enriched);
		const ecrit = writeSnapshots(enriched);

		return { weekId, games: gamesUpserted, snapshots: ecrit.created, fallbacks: ecrit.fallbacks };
	});

	logger.info(
		`Semaine de rejeu creee : ${label} (${result.games} matchs, ${result.snapshots} baremes` +
			(result.fallbacks.length ? `, ${result.fallbacks.length} sans cotes historiques` : '') +
			')'
	);

	return { ...result, label };
}

// ---------------------------------------------------------------------------
// Simulation acceleree
// ---------------------------------------------------------------------------

export function createSimulationWeek(): TestWeekResult {
	if (!mockEnabled()) {
		throw new Error(
			'Mode simulation indisponible : demarrer l\'application avec MOCK_ESPN=1. ' +
				'Sans cette variable, aucun match fictif ne peut entrer en base.'
		);
	}

	const season = currentSeason();
	const numero = numeroLibre(season);
	const label = `${TEST_LABEL_PREFIX} · Simulation`;
	const ts = now();
	const fixtures = mockCreateGames(ts);

	const result = db.transaction(() => {
		const weekId = db
			.insert(weeks)
			.values({
				season,
				seasontype: SEASONTYPE_REGULAR,
				number: numero,
				label,
				status: 'ouverte',
				snapshotAt: ts,
				testKind: 'simulation'
			})
			.returning({ id: weeks.id })
			.get().id;

		const gamesUpserted = upsertGames(weekId, fixtures);
		const ecrit = writeSnapshots(fixtures);

		return { weekId, games: gamesUpserted, snapshots: ecrit.created, fallbacks: ecrit.fallbacks };
	});

	logger.info(
		`Semaine de simulation creee : ${result.games} matchs, kickoffs a +5, +10, +15 et +20 min.`
	);

	return { ...result, label };
}

// ---------------------------------------------------------------------------
// Inventaire et purge
// ---------------------------------------------------------------------------

export interface TestWeekSummary {
	week: Week;
	games: number;
	picks: number;
	scores: number;
}

export function listTestWeeks(): TestWeekSummary[] {
	const rows = db
		.select()
		.from(weeks)
		.where(isNotNull(weeks.testKind))
		.orderBy(weeks.season, weeks.number)
		.all();

	return rows.map((week) => {
		const compte = sqlite
			.prepare(
				`SELECT
					(SELECT COUNT(*) FROM games  WHERE week_id = @weekId) AS games,
					(SELECT COUNT(*) FROM picks  WHERE game_id IN (SELECT id FROM games WHERE week_id = @weekId)) AS picks,
					(SELECT COUNT(*) FROM scores WHERE week_id = @weekId) AS scores`
			)
			.get({ weekId: week.id }) as { games: number; picks: number; scores: number };
		return { week, ...compte };
	});
}

export interface PurgeReport {
	weeks: number;
	games: number;
	picks: number;
	scores: number;
	odds: number;
	labels: string[];
}

/**
 * Supprime toutes les semaines marquees et ce qui en depend.
 *
 * L'ordre suit les cles etrangeres (`PRAGMA foreign_keys = ON` cote db) :
 * scores et pronostics d'abord, puis les baremes, puis les matchs, puis les
 * semaines. Aucune ligne n'est supprimee par un `ON DELETE CASCADE` — le
 * schema n'en declare pas — donc tout est explicite ici.
 *
 * Les pronostics et les scores sont vises **par match autant que par
 * semaine** : c'est redondant tant que `scores.week_id` correspond au match,
 * et c'est justement ce qu'on ne veut pas avoir a supposer au moment de
 * nettoyer.
 */
export function purgeTestWeeks(): PurgeReport {
	const cibles = db
		.select({ id: weeks.id, label: weeks.label })
		.from(weeks)
		.where(isNotNull(weeks.testKind))
		.all();

	if (cibles.length === 0) {
		return { weeks: 0, games: 0, picks: 0, scores: 0, odds: 0, labels: [] };
	}

	const SEMAINES = `SELECT id FROM weeks WHERE test_kind IS NOT NULL`;
	const MATCHS = `SELECT id FROM games WHERE week_id IN (${SEMAINES})`;

	const rapport = sqlite.transaction(() => {
		const scores = sqlite
			.prepare(`DELETE FROM scores WHERE week_id IN (${SEMAINES}) OR game_id IN (${MATCHS})`)
			.run().changes;
		const picks = sqlite.prepare(`DELETE FROM picks WHERE game_id IN (${MATCHS})`).run().changes;
		const odds = sqlite
			.prepare(`DELETE FROM odds_snapshots WHERE game_id IN (${MATCHS})`)
			.run().changes;
		const jeux = sqlite.prepare(`DELETE FROM games WHERE week_id IN (${SEMAINES})`).run().changes;
		const semaines = sqlite.prepare(`DELETE FROM weeks WHERE test_kind IS NOT NULL`).run().changes;
		return { weeks: semaines, games: jeux, picks, scores, odds };
	})();

	logger.info(
		`Purge des semaines de test : ${rapport.weeks} semaine(s), ${rapport.games} match(s), ` +
			`${rapport.picks} pronostic(s), ${rapport.scores} ligne(s) de points, ` +
			`${rapport.odds} bareme(s) — ${cibles.map((c) => c.label).join(', ')}`
	);

	return { ...rapport, labels: cibles.map((c) => c.label) };
}

/**
 * Controle d'integrite apres purge : lignes referencant une semaine ou un
 * match disparu. Doit toujours renvoyer des zeros ; sert au test et au
 * diagnostic depuis l'admin.
 */
export function orphelins(): { games: number; picks: number; scores: number; odds: number } {
	return sqlite
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM games  WHERE week_id NOT IN (SELECT id FROM weeks)) AS games,
				(SELECT COUNT(*) FROM picks  WHERE game_id NOT IN (SELECT id FROM games)) AS picks,
				(SELECT COUNT(*) FROM scores WHERE game_id NOT IN (SELECT id FROM games)
					OR week_id NOT IN (SELECT id FROM weeks)) AS scores,
				(SELECT COUNT(*) FROM odds_snapshots WHERE game_id NOT IN (SELECT id FROM games)) AS odds`
		)
		.get() as { games: number; picks: number; scores: number; odds: number };
}

/** Utilise par l'admin pour n'afficher le bouton de simulation que s'il sert. */
export { mockEnabled };

/** L'admin annonce combien de matchs la simulation va creer. */
export const NB_FIXTURES = FIXTURES.length;
