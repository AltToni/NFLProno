import { sqlite } from './db';
import { currentSeason } from './settings';
import type { EvolutionPoint, EvolutionSeries, StandingRow } from '$lib/types';

export type { EvolutionPoint, EvolutionSeries, StandingRow } from '$lib/types';

/**
 * Departage a egalite (spec 4) : points, puis nombre d'ecarts exacts. Les ex
 * aequo parfaits partagent le meme rang.
 */
function rankRows(rows: Omit<StandingRow, 'rank' | 'successRate' | 'averagePoints'>[]): StandingRow[] {
	const sorted = [...rows].sort(
		(a, b) =>
			b.points - a.points ||
			b.exactMargins - a.exactMargins ||
			a.pseudo.localeCompare(b.pseudo, 'fr')
	);

	let lastRank = 0;
	let lastKey = '';
	return sorted.map((row, index) => {
		const key = `${row.points}|${row.exactMargins}`;
		if (key !== lastKey) {
			lastRank = index + 1;
			lastKey = key;
		}
		return {
			...row,
			rank: lastRank,
			successRate: row.played > 0 ? row.corrects / row.played : 0,
			averagePoints: row.played > 0 ? row.points / row.played : 0
		};
	});
}

/**
 * `test_kind IS NULL` revient dans toutes les requetes de ce module : le
 * classement general, le graphe d'evolution et les stats d'un joueur ne voient
 * que les vraies semaines. Le classement *hebdomadaire*, lui, ne filtre pas —
 * il porte sur une semaine designee, et c'est justement la qu'on va verifier
 * que le rejeu a bien calcule ses points.
 */
const SEASON_STANDINGS = `
	SELECT u.id AS userId, u.pseudo, u.avatar,
		COALESCE(SUM(s.points), 0)       AS points,
		COALESCE(SUM(s.exact_margin), 0) AS exactMargins,
		COALESCE(SUM(s.correct), 0)      AS corrects,
		COUNT(s.id)                      AS played
	FROM users u
	LEFT JOIN scores s
		ON s.user_id = u.id
		AND s.week_id IN (SELECT id FROM weeks WHERE season = @season AND test_kind IS NULL)
	WHERE u.active = 1
	GROUP BY u.id
`;

const WEEK_STANDINGS = `
	SELECT u.id AS userId, u.pseudo, u.avatar,
		COALESCE(SUM(s.points), 0)       AS points,
		COALESCE(SUM(s.exact_margin), 0) AS exactMargins,
		COALESCE(SUM(s.correct), 0)      AS corrects,
		COUNT(s.id)                      AS played
	FROM users u
	LEFT JOIN scores s ON s.user_id = u.id AND s.week_id = @weekId
	WHERE u.active = 1
	GROUP BY u.id
`;

export function seasonStandings(season = currentSeason()): StandingRow[] {
	const rows = sqlite.prepare(SEASON_STANDINGS).all({ season }) as any[];
	return rankRows(rows);
}

export function weekStandings(weekId: number): StandingRow[] {
	const rows = sqlite.prepare(WEEK_STANDINGS).all({ weekId }) as any[];
	return rankRows(rows);
}

/** Vainqueur d'une semaine, ou null en cas d'ex aequo strict ou d'absence de points. */
export function weekWinner(weekId: number): { userId: number; points: number } | null {
	const standings = weekStandings(weekId).filter((r) => r.played > 0);
	if (standings.length === 0) return null;
	const top = standings.filter((r) => r.rank === 1);
	if (top.length !== 1) return null;
	return { userId: top[0].userId, points: top[0].points };
}

/**
 * Graphe d'evolution des positions semaine par semaine (spec 4) : rang du
 * classement general cumule a l'issue de chaque semaine deja jouee.
 */
export function rankEvolution(season = currentSeason()): {
	weeks: { id: number; label: string }[];
	series: EvolutionSeries[];
} {
	const weekRows = sqlite
		.prepare(
			`SELECT id, label FROM weeks
			 WHERE season = @season AND test_kind IS NULL
				   AND status IN ('ouverte', 'cloturee')
			 ORDER BY seasontype ASC, number ASC`
		)
		.all({ season }) as { id: number; label: string }[];

	const users = sqlite
		.prepare(`SELECT id, pseudo FROM users WHERE active = 1 ORDER BY pseudo COLLATE NOCASE`)
		.all() as { id: number; pseudo: string }[];

	const perWeek = sqlite
		.prepare(
			`SELECT s.week_id AS weekId, s.user_id AS userId,
				SUM(s.points) AS points,
				SUM(s.exact_margin) AS exactMargins
			 FROM scores s
			 JOIN weeks w ON w.id = s.week_id
			 WHERE w.season = @season AND w.test_kind IS NULL
			 GROUP BY s.week_id, s.user_id`
		)
		.all({ season }) as {
		weekId: number;
		userId: number;
		points: number;
		exactMargins: number;
	}[];

	const byWeek = new Map<number, Map<number, (typeof perWeek)[number]>>();
	for (const row of perWeek) {
		if (!byWeek.has(row.weekId)) byWeek.set(row.weekId, new Map());
		byWeek.get(row.weekId)!.set(row.userId, row);
	}

	const cumulative = new Map<number, { points: number; exactMargins: number }>();
	for (const u of users) cumulative.set(u.id, { points: 0, exactMargins: 0 });

	const series = new Map<number, EvolutionPoint[]>();
	for (const u of users) series.set(u.id, []);

	// Les semaines sans aucun point (pas encore jouees) ne creent pas de point
	// sur le graphe : la courbe s'arrete a la derniere semaine scoree.
	for (const week of weekRows) {
		const rows = byWeek.get(week.id);
		if (!rows || rows.size === 0) continue;

		for (const u of users) {
			const acc = cumulative.get(u.id)!;
			const delta = rows.get(u.id);
			acc.points += delta?.points ?? 0;
			acc.exactMargins += delta?.exactMargins ?? 0;
		}

		const ordered = [...users]
			.map((u) => ({ user: u, acc: cumulative.get(u.id)! }))
			.sort(
				(a, b) =>
					b.acc.points - a.acc.points ||
					b.acc.exactMargins - a.acc.exactMargins ||
					a.user.pseudo.localeCompare(b.user.pseudo, 'fr')
			);

		let lastRank = 0;
		let lastKey = '';
		ordered.forEach((entry, index) => {
			const key = `${entry.acc.points}|${entry.acc.exactMargins}`;
			if (key !== lastKey) {
				lastRank = index + 1;
				lastKey = key;
			}
			series.get(entry.user.id)!.push({
				weekId: week.id,
				label: week.label,
				rank: lastRank,
				points: rows.get(entry.user.id)?.points ?? 0,
				cumulative: entry.acc.points
			});
		});
	}

	const usedWeeks = weekRows.filter((w) => byWeek.has(w.id));

	return {
		weeks: usedWeeks.map((w) => ({ id: w.id, label: w.label })),
		series: users.map((u) => ({ userId: u.id, pseudo: u.pseudo, points: series.get(u.id)! }))
	};
}

export interface PlayerStats {
	points: number;
	played: number;
	corrects: number;
	exactMargins: number;
	successRate: number;
	averagePoints: number;
	bestUpset: {
		gameId: string;
		label: string;
		points: number;
		probability: number;
	} | null;
	weeklyWins: number;
}

export function playerStats(userId: number, season = currentSeason()): PlayerStats {
	const agg = sqlite
		.prepare(
			`SELECT COALESCE(SUM(s.points), 0) AS points,
				COUNT(s.id) AS played,
				COALESCE(SUM(s.correct), 0) AS corrects,
				COALESCE(SUM(s.exact_margin), 0) AS exactMargins
			 FROM scores s
			 JOIN weeks w ON w.id = s.week_id
			 WHERE s.user_id = @userId AND w.season = @season AND w.test_kind IS NULL`
		)
		.get({ userId, season }) as any;

	// `pick_side IS NOT NULL` ecarte le nul predit, qui ne designe aucune equipe :
	// aucune probabilite ne lui correspond, il n'a donc pas sa place dans le
	// palmares des upsets.
	const upset = sqlite
		.prepare(
			`SELECT s.game_id AS gameId, s.points AS points,
				g.home_abbr AS homeAbbr, g.away_abbr AS awayAbbr,
				CASE p.pick_side WHEN 'home' THEN o.p_home ELSE o.p_away END AS probability,
				CASE p.pick_side WHEN 'home' THEN g.home_abbr ELSE g.away_abbr END AS pickedAbbr
			 FROM scores s
			 JOIN picks p ON p.user_id = s.user_id AND p.game_id = s.game_id
			 JOIN games g ON g.id = s.game_id
			 JOIN odds_snapshots o ON o.game_id = s.game_id
			 JOIN weeks w ON w.id = s.week_id
			 WHERE s.user_id = @userId AND s.correct = 1 AND w.season = @season
				   AND w.test_kind IS NULL AND p.pick_side IS NOT NULL
			 ORDER BY probability ASC, s.points DESC
			 LIMIT 1`
		)
		.get({ userId, season }) as any;

	const weeklyWins = sqlite
		.prepare(
			`SELECT COUNT(*) AS n FROM weeks WHERE season = @season AND test_kind IS NULL
				   AND winner_user_id = @userId`
		)
		.get({ userId, season }) as { n: number };

	return {
		points: agg?.points ?? 0,
		played: agg?.played ?? 0,
		corrects: agg?.corrects ?? 0,
		exactMargins: agg?.exactMargins ?? 0,
		successRate: agg?.played > 0 ? agg.corrects / agg.played : 0,
		averagePoints: agg?.played > 0 ? agg.points / agg.played : 0,
		bestUpset: upset
			? {
					gameId: upset.gameId,
					label: `${upset.pickedAbbr} (${upset.awayAbbr} @ ${upset.homeAbbr})`,
					points: upset.points,
					probability: upset.probability
				}
			: null,
		weeklyWins: weeklyWins?.n ?? 0
	};
}

/** Historique detaille d'un joueur, du plus recent au plus ancien. */
export function playerHistory(userId: number, season = currentSeason()) {
	return sqlite
		.prepare(
			`SELECT g.id AS gameId, g.home_abbr AS homeAbbr, g.away_abbr AS awayAbbr,
				g.score_home AS scoreHome, g.score_away AS scoreAway, g.status,
				g.kickoff_utc AS kickoffUtc,
				w.label AS weekLabel, w.id AS weekId,
				p.pick_side AS pickSide, p.margin_pred AS marginPred,
				o.base_points_home AS basePointsHome, o.base_points_away AS basePointsAway,
				s.points, s.base_points AS basePoints, s.bonus_points AS bonusPoints,
				s.bonus_kind AS bonusKind, s.correct
			 FROM picks p
			 JOIN games g ON g.id = p.game_id
			 JOIN weeks w ON w.id = g.week_id
			 LEFT JOIN odds_snapshots o ON o.game_id = g.id
			 LEFT JOIN scores s ON s.game_id = g.id AND s.user_id = p.user_id
			 WHERE p.user_id = @userId AND w.season = @season AND w.test_kind IS NULL
			 ORDER BY g.kickoff_utc DESC`
		)
		.all({ userId, season }) as any[];
}
