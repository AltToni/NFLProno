import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from './db';
import { games, oddsSnapshots, weeks } from './db/schema';
import { enrichOdds, getCurrentPeriod, getScoreboard, type EspnGame } from './espn';
import { getScoringConfig, currentSeason } from './settings';
import { stakesFromMoneylines } from '$lib/scoring';
import { ensureWeek } from './weeks';
import { logger } from './logger';
import { now } from '$lib/time';

export interface SyncResult {
	season: number;
	seasontype: number;
	week: number;
	weekId: number;
	weekLabel: string;
	gamesUpserted: number;
	snapshotsCreated: number;
	snapshotsSkipped: number;
	fallbacks: string[];
}

/**
 * Ecrit / met a jour les matchs d'une semaine. Ne touche jamais aux cotes.
 * Un score corrige a la main par un admin (`manual_override`) n'est pas ecrase.
 */
export function upsertGames(weekId: number, espnGames: EspnGame[]): number {
	const ts = now();
	let count = 0;

	const tx = db.transaction(() => {
		for (const g of espnGames) {
			const existing = db.select().from(games).where(eq(games.id, g.id)).get();
			const neutralized = g.status === 'postponed' || g.status === 'canceled' ? 1 : 0;

			if (!existing) {
				db.insert(games)
					.values({
						id: g.id,
						weekId,
						homeTeamId: g.home.id,
						homeAbbr: g.home.abbreviation,
						homeName: g.home.displayName,
						homeLogo: g.home.logo,
						awayTeamId: g.away.id,
						awayAbbr: g.away.abbreviation,
						awayName: g.away.displayName,
						awayLogo: g.away.logo,
						kickoffUtc: g.kickoffUtc,
						status: g.status,
						statusDetail: g.statusDetail,
						scoreHome: g.scoreHome,
						scoreAway: g.scoreAway,
						neutralized,
						updatedAt: ts
					})
					.run();
				count++;
				continue;
			}

			const patch: Record<string, unknown> = {
				weekId,
				homeTeamId: g.home.id,
				homeAbbr: g.home.abbreviation,
				homeName: g.home.displayName,
				homeLogo: g.home.logo,
				awayTeamId: g.away.id,
				awayAbbr: g.away.abbreviation,
				awayName: g.away.displayName,
				awayLogo: g.away.logo,
				kickoffUtc: g.kickoffUtc,
				neutralized
			};

			// Une correction manuelle fait autorite sur le flux ESPN.
			if (existing.manualOverride !== 1) {
				patch.status = g.status;
				patch.statusDetail = g.statusDetail;
				patch.scoreHome = g.scoreHome;
				patch.scoreAway = g.scoreAway;
			}

			// `updated_at` ne bouge que si quelque chose a reellement change : le
			// recalcul des points s'appuie dessus pour savoir ce qui est a refaire.
			const changed = Object.entries(patch).some(
				([key, value]) => (existing as Record<string, unknown>)[key] !== value
			);
			if (!changed) continue;

			patch.updatedAt = ts;
			db.update(games).set(patch).where(eq(games.id, g.id)).run();
			count++;
		}
	});
	tx();

	return count;
}

/**
 * Snapshot hebdomadaire (spec 3, mercredi 09:00) : fige le bareme de la semaine
 * puis ouvre les pronostics.
 *
 * Idempotent : une ligne `odds_snapshots` deja presente n'est jamais reecrite,
 * sauf `force` explicite depuis l'admin. C'est ce qui garantit le critere
 * d'acceptation 2 (les enjeux affiches ne bougent plus).
 */
export async function runSnapshot(
	options: {
		season?: number;
		seasontype?: number;
		week?: number;
		force?: boolean;
		open?: boolean;
	} = {}
): Promise<SyncResult> {
	const season = options.season ?? currentSeason();

	let seasontype: number;
	let week: number;

	if (options.seasontype !== undefined && options.week !== undefined) {
		seasontype = options.seasontype;
		week = options.week;
	} else {
		const period = await getCurrentPeriod();
		seasontype = options.seasontype ?? period.seasontype ?? 2;
		week = options.week ?? period.week;
	}

	if (!Number.isFinite(week) || week < 1) {
		throw new Error('Impossible de determiner la semaine courante depuis ESPN');
	}

	const { parsed, raw } = await getScoreboard(season, seasontype, week);
	if (parsed.games.length === 0) {
		throw new Error(`Aucun match renvoye par ESPN pour ${season} / type ${seasontype} / semaine ${week}`);
	}

	const weekRow = ensureWeek(season, seasontype, week);
	const gamesUpserted = upsertGames(weekRow.id, parsed.games);

	// Complete les cotes manquantes via la core API avant de figer le bareme.
	const enriched = await enrichOdds(parsed.games);

	const cfg = getScoringConfig();
	const ts = now();
	let snapshotsCreated = 0;
	let snapshotsSkipped = 0;
	const fallbacks: string[] = [];

	const tx = db.transaction(() => {
		for (const g of enriched) {
			const existing = db.select().from(oddsSnapshots).where(eq(oddsSnapshots.gameId, g.id)).get();
			if (existing && !options.force) {
				snapshotsSkipped++;
				if (existing.fallback === 1) fallbacks.push(`${g.away.abbreviation} @ ${g.home.abbreviation}`);
				continue;
			}

			const stakes = stakesFromMoneylines(g.odds?.moneylineHome, g.odds?.moneylineAway, cfg);
			if (stakes.fallback) fallbacks.push(`${g.away.abbreviation} @ ${g.home.abbreviation}`);

			const values = {
				gameId: g.id,
				moneylineHome: g.odds?.moneylineHome ?? null,
				moneylineAway: g.odds?.moneylineAway ?? null,
				spread: g.odds?.spread ?? null,
				overUnder: g.odds?.overUnder ?? null,
				pHome: stakes.pHome,
				pAway: stakes.pAway,
				basePointsHome: stakes.basePointsHome,
				basePointsAway: stakes.basePointsAway,
				fallback: stakes.fallback ? 1 : 0,
				provider: g.odds?.provider ?? null,
				rawJson: JSON.stringify(g.odds?.raw ?? null),
				capturedAt: ts
			};

			db.insert(oddsSnapshots)
				.values(values)
				.onConflictDoUpdate({ target: oddsSnapshots.gameId, set: values })
				.run();
			snapshotsCreated++;
		}

		db.update(weeks)
			.set({
				snapshotAt: ts,
				status: options.open === false ? weekRow.status : 'ouverte'
			})
			.where(eq(weeks.id, weekRow.id))
			.run();
	});
	tx();

	// Trace brute du scoreboard pour l'audit du bareme.
	logger.info(
		`Snapshot ${season}/T${seasontype}/S${week} : ${gamesUpserted} matchs, ` +
			`${snapshotsCreated} baremes figes, ${snapshotsSkipped} conserves, ` +
			`${fallbacks.length} repli(s)` +
			(fallbacks.length ? ` -> ${fallbacks.join(', ')}` : ''),
		{ rawBytes: JSON.stringify(raw).length }
	);

	return {
		season,
		seasontype,
		week,
		weekId: weekRow.id,
		weekLabel: weekRow.label,
		gamesUpserted,
		snapshotsCreated,
		snapshotsSkipped,
		fallbacks
	};
}

/**
 * Rafraichit statuts et scores des semaines encore en cours, sans jamais
 * toucher au bareme fige.
 */
export async function syncScores(): Promise<{ weeks: number; games: number; finals: number }> {
	const season = currentSeason();

	// On rafraichit toute semaine ouverte, plus toute semaine contenant encore
	// des matchs non termines.
	const candidates = db
		.select({ id: weeks.id, seasontype: weeks.seasontype, number: weeks.number })
		.from(weeks)
		.where(and(eq(weeks.season, season), ne(weeks.status, 'a_venir')))
		.all();

	let touchedGames = 0;
	let finals = 0;
	let touchedWeeks = 0;

	for (const w of candidates) {
		const pending = db
			.select({ id: games.id })
			.from(games)
			.where(and(eq(games.weekId, w.id), inArray(games.status, ['scheduled', 'in'])))
			.all();
		if (pending.length === 0) continue;

		try {
			const { parsed } = await getScoreboard(season, w.seasontype, w.number);
			if (parsed.games.length === 0) continue;
			touchedGames += upsertGames(w.id, parsed.games);
			finals += parsed.games.filter((g) => g.status === 'final').length;
			touchedWeeks++;
		} catch (error) {
			logger.error(
				`Poll des scores en echec pour T${w.seasontype}/S${w.number} : ${(error as Error).message}`
			);
		}
	}

	return { weeks: touchedWeeks, games: touchedGames, finals };
}
