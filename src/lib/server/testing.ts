import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { weeks } from './db/schema';
import { compterSemaine, orphelins, purgerSemaines, type PurgeReport } from './purge';
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

	return rows.map((week) => ({ week, ...compterSemaine(week.id) }));
}

/** Supprime toutes les semaines marquees et ce qui en depend. */
export function purgeTestWeeks(): PurgeReport {
	return purgerSemaines('test_kind IS NOT NULL', 'semaines de test');
}

export type { PurgeReport } from './purge';
export { orphelins };

/** Utilise par l'admin pour n'afficher le bouton de simulation que s'il sert. */
export { mockEnabled };

/** L'admin annonce combien de matchs la simulation va creer. */
export const NB_FIXTURES = FIXTURES.length;
