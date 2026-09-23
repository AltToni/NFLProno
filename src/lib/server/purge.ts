import { sqlite } from './db';
import { logger } from './logger';

/**
 * Suppression d'un lot de semaines et de tout ce qui en depend.
 *
 * Deux appelants, deux conditions : les semaines de test (`test_kind`) et les
 * semaines de presaison (remise a zero avant la vraie saison). Le nettoyage,
 * lui, est le meme — c'est pour ca qu'il vit ici plutot que d'etre recopie.
 */

export interface PurgeReport {
	weeks: number;
	games: number;
	picks: number;
	scores: number;
	odds: number;
	adjustments: number;
	labels: string[];
}

/**
 * Supprime les semaines qui satisfont `condition` (un fragment SQL portant sur
 * `weeks`) et ce qui en depend.
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
 *
 * `condition` est ecrite par l'appelant, jamais par un formulaire : les seuls
 * nombres qui y entrent sont des entiers verifies (saison, type de saison).
 */
export function purgerSemaines(condition: string, contexte: string): PurgeReport {
	const SEMAINES = `SELECT id FROM weeks WHERE ${condition}`;
	const MATCHS = `SELECT id FROM games WHERE week_id IN (${SEMAINES})`;

	const cibles = sqlite
		.prepare(`SELECT id, label FROM weeks WHERE ${condition} ORDER BY seasontype, number`)
		.all() as { id: number; label: string }[];

	if (cibles.length === 0) {
		return { weeks: 0, games: 0, picks: 0, scores: 0, odds: 0, adjustments: 0, labels: [] };
	}

	const rapport = sqlite.transaction(() => {
		const scores = sqlite
			.prepare(`DELETE FROM scores WHERE week_id IN (${SEMAINES}) OR game_id IN (${MATCHS})`)
			.run().changes;
		// Un ajustement pointe la semaine, pas le match : il ne part avec aucune
		// autre suppression, et resterait a crediter des points d'une semaine
		// disparue.
		const adjustments = sqlite
			.prepare(`DELETE FROM score_adjustments WHERE week_id IN (${SEMAINES})`)
			.run().changes;
		const picks = sqlite.prepare(`DELETE FROM picks WHERE game_id IN (${MATCHS})`).run().changes;
		const odds = sqlite.prepare(`DELETE FROM odds_snapshots WHERE game_id IN (${MATCHS})`).run()
			.changes;
		const jeux = sqlite.prepare(`DELETE FROM games WHERE week_id IN (${SEMAINES})`).run().changes;
		const semaines = sqlite.prepare(`DELETE FROM weeks WHERE ${condition}`).run().changes;
		return { weeks: semaines, games: jeux, picks, scores, odds, adjustments };
	})();

	logger.info(
		`Purge (${contexte}) : ${rapport.weeks} semaine(s), ${rapport.games} match(s), ` +
			`${rapport.picks} pronostic(s), ${rapport.scores} ligne(s) de points, ` +
			`${rapport.odds} bareme(s), ${rapport.adjustments} ajustement(s) — ` +
			`${cibles.map((c) => c.label).join(', ')}`
	);

	return { ...rapport, labels: cibles.map((c) => c.label) };
}

/**
 * Controle d'integrite apres purge : lignes referencant une semaine ou un
 * match disparu. Doit toujours renvoyer des zeros ; sert au test et au
 * diagnostic depuis l'admin.
 */
export interface OrphanReport {
	games: number;
	picks: number;
	scores: number;
	odds: number;
	adjustments: number;
}

export function orphelins(): OrphanReport {
	return sqlite
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM games  WHERE week_id NOT IN (SELECT id FROM weeks)) AS games,
				(SELECT COUNT(*) FROM picks  WHERE game_id NOT IN (SELECT id FROM games)) AS picks,
				(SELECT COUNT(*) FROM scores WHERE game_id NOT IN (SELECT id FROM games)
					OR week_id NOT IN (SELECT id FROM weeks)) AS scores,
				(SELECT COUNT(*) FROM odds_snapshots WHERE game_id NOT IN (SELECT id FROM games)) AS odds,
				(SELECT COUNT(*) FROM score_adjustments WHERE week_id NOT IN (SELECT id FROM weeks)
					OR user_id NOT IN (SELECT id FROM users)) AS adjustments`
		)
		.get() as OrphanReport;
}

/** Compte matchs, pronostics et lignes de points rattaches a une semaine. */
export function compterSemaine(weekId: number): { games: number; picks: number; scores: number } {
	return sqlite
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM games  WHERE week_id = @weekId) AS games,
				(SELECT COUNT(*) FROM picks  WHERE game_id IN (SELECT id FROM games WHERE week_id = @weekId)) AS picks,
				(SELECT COUNT(*) FROM scores WHERE week_id = @weekId) AS scores`
		)
		.get({ weekId }) as { games: number; picks: number; scores: number };
}
