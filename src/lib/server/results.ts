import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { games, oddsSnapshots, picks, scores, weeks } from './db/schema';
import { basePoints, computeScore, playoffMultiplier } from '$lib/scoring';
import { getScoringConfig, currentSeason } from './settings';
import { logger } from './logger';
import { now } from '$lib/time';

export interface ComputeReport {
	gamesConsidered: number;
	gamesScored: number;
	picksScored: number;
	gamesNeutralized: number;
	missingSnapshots: string[];
}

/** Rapport vierge — fonction et non constante, pour ne jamais partager le tableau. */
function emptyReport(): ComputeReport {
	return {
		gamesConsidered: 0,
		gamesScored: 0,
		picksScored: 0,
		gamesNeutralized: 0,
		missingSnapshots: []
	};
}

/**
 * Calcule les points d'un match termine. Entierement idempotent : les lignes
 * `scores` du match sont reecrites a chaque appel a partir des pronostics et du
 * bareme fige (critere d'acceptation 5).
 */
export function computeGameScores(
	gameId: string,
	report: ComputeReport = emptyReport()
): ComputeReport {
	const game = db.select().from(games).where(eq(games.id, gameId)).get();
	if (!game) return report;

	report.gamesConsidered++;

	const week = db.select().from(weeks).where(eq(weeks.id, game.weekId)).get();
	const cfg = getScoringConfig();
	const ts = now();

	// Match reporte / annule : neutralise, 0 point pour tout le monde.
	if (game.neutralized === 1 || game.status === 'postponed' || game.status === 'canceled') {
		db.delete(scores).where(eq(scores.gameId, gameId)).run();
		report.gamesNeutralized++;
		return report;
	}

	if (game.status !== 'final' || game.scoreHome === null || game.scoreAway === null) {
		return report;
	}

	const snapshot = db.select().from(oddsSnapshots).where(eq(oddsSnapshots.gameId, gameId)).get();
	let baseHome: number;
	let baseAway: number;

	if (snapshot) {
		baseHome = snapshot.basePointsHome;
		baseAway = snapshot.basePointsAway;
	} else {
		// Ne doit pas arriver (le snapshot cree toujours une ligne, fallback
		// compris) mais on prefere scorer avec le repli plutot que bloquer.
		baseHome = basePoints(cfg.fallbackP, cfg);
		baseAway = basePoints(1 - cfg.fallbackP, cfg);
		report.missingSnapshots.push(`${game.awayAbbr} @ ${game.homeAbbr}`);
		logger.warn(`Aucun snapshot de cotes pour le match ${gameId}, repli applique`);
	}

	const multiplier = week ? playoffMultiplier(week.seasontype, week.number, cfg) : 1;
	const gamePicks = db.select().from(picks).where(eq(picks.gameId, gameId)).all();

	db.transaction(() => {
		db.delete(scores).where(eq(scores.gameId, gameId)).run();

		for (const pick of gamePicks) {
			const breakdown = computeScore(
				{
					pickSide: pick.pickSide,
					scoreHomePred: pick.scoreHomePred,
					scoreAwayPred: pick.scoreAwayPred
				},
				{ basePointsHome: baseHome, basePointsAway: baseAway, multiplier },
				{ scoreHome: game.scoreHome as number, scoreAway: game.scoreAway as number },
				cfg
			);

			db.insert(scores)
				.values({
					userId: pick.userId,
					gameId,
					weekId: game.weekId,
					points: breakdown.points,
					basePoints: breakdown.basePoints,
					bonusPoints: breakdown.bonusPoints,
					bonusKind: breakdown.bonusKind,
					multiplier: breakdown.multiplier,
					correct: breakdown.correct ? 1 : 0,
					exactScore: breakdown.exactScore ? 1 : 0,
					exactMargin: breakdown.exactMargin ? 1 : 0,
					computedAt: ts
				})
				.run();
			report.picksScored++;
		}
	});

	report.gamesScored++;
	return report;
}

/** Recalcule tous les matchs termines d'une semaine. */
export function computeWeekScores(weekId: number): ComputeReport {
	const report = emptyReport();
	const rows = db
		.select({ id: games.id })
		.from(games)
		.where(and(eq(games.weekId, weekId), inArray(games.status, ['final', 'postponed', 'canceled'])))
		.all();
	for (const row of rows) computeGameScores(row.id, report);
	return report;
}

/** Recalcul global de la saison, declenchable depuis l'admin. */
export function recomputeSeason(season = currentSeason()): ComputeReport {
	const report = emptyReport();
	const rows = db
		.select({ id: games.id })
		.from(games)
		.innerJoin(weeks, eq(games.weekId, weeks.id))
		.where(and(eq(weeks.season, season), inArray(games.status, ['final', 'postponed', 'canceled'])))
		.all();
	for (const row of rows) computeGameScores(row.id, report);
	logger.info(
		`Recalcul saison ${season} : ${report.gamesScored} matchs, ${report.picksScored} pronostics`
	);
	return report;
}

/**
 * Score tous les matchs termines qui n'ont pas encore de lignes de points.
 * Appele apres chaque poll de scores.
 */
export function computePendingScores(season = currentSeason()): ComputeReport {
	const report = emptyReport();

	const finals = db
		.select({ id: games.id, updatedAt: games.updatedAt })
		.from(games)
		.innerJoin(weeks, eq(games.weekId, weeks.id))
		.where(and(eq(weeks.season, season), inArray(games.status, ['final', 'postponed', 'canceled'])))
		.all();

	for (const game of finals) {
		const pickRows = db.select({ id: picks.id }).from(picks).where(eq(picks.gameId, game.id)).all();
		const scoreRows = db
			.select({ computedAt: scores.computedAt })
			.from(scores)
			.where(eq(scores.gameId, game.id))
			.all();

		// A jour = autant de lignes de points que de pronostics, toutes calculees
		// apres la derniere modification du match.
		const upToDate =
			scoreRows.length === pickRows.length &&
			(scoreRows.length === 0 || Math.min(...scoreRows.map((s) => s.computedAt)) >= game.updatedAt);

		if (upToDate) continue;
		computeGameScores(game.id, report);
	}

	return report;
}
