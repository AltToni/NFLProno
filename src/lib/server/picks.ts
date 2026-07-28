import { and, asc, eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { games, oddsSnapshots, picks, scores, users, weeks } from './db/schema';
import { isPickConsistent, type PickSide } from '$lib/scoring';
import { ignoreLeKickoff } from '$lib/nfl';
import type { BoardGame } from '$lib/types';
import { now } from '$lib/time';

export type { BoardGame } from '$lib/types';

/** Grille de pronostics d'une semaine pour un joueur donne. */
export function weekBoard(weekId: number, userId: number): BoardGame[] {
	const ts = now();

	// Sur une semaine de rejeu, les kickoffs sont ceux de la saison rejouee :
	// tout serait verrouille d'entree et la grille ne serait pas saisissable.
	const week = db.select({ testKind: weeks.testKind }).from(weeks).where(eq(weeks.id, weekId)).get();
	const kickoffNeutralise = ignoreLeKickoff(week?.testKind);

	const rows = db
		.select({
			game: games,
			odds: oddsSnapshots,
			pick: picks,
			score: scores
		})
		.from(games)
		.leftJoin(oddsSnapshots, eq(oddsSnapshots.gameId, games.id))
		.leftJoin(picks, and(eq(picks.gameId, games.id), eq(picks.userId, userId)))
		.leftJoin(scores, and(eq(scores.gameId, games.id), eq(scores.userId, userId)))
		.where(eq(games.weekId, weekId))
		.orderBy(asc(games.kickoffUtc))
		.all();

	const counts = new Map<string, number>();
	for (const row of sqlite
		.prepare(
			`SELECT p.game_id AS gameId, COUNT(*) AS n
			 FROM picks p JOIN games g ON g.id = p.game_id
			 WHERE g.week_id = ? GROUP BY p.game_id`
		)
		.all(weekId) as { gameId: string; n: number }[]) {
		counts.set(row.gameId, row.n);
	}

	return rows.map(({ game, odds, pick, score }) => ({
		id: game.id,
		homeAbbr: game.homeAbbr,
		homeName: game.homeName,
		homeLogo: game.homeLogo,
		awayAbbr: game.awayAbbr,
		awayName: game.awayName,
		awayLogo: game.awayLogo,
		kickoffUtc: game.kickoffUtc,
		status: game.status,
		statusDetail: game.statusDetail,
		scoreHome: game.scoreHome,
		scoreAway: game.scoreAway,
		neutralized: game.neutralized === 1,
		locked: !kickoffNeutralise && ts >= game.kickoffUtc,
		basePointsHome: odds?.basePointsHome ?? null,
		basePointsAway: odds?.basePointsAway ?? null,
		pHome: odds?.pHome ?? null,
		pAway: odds?.pAway ?? null,
		fallbackOdds: odds?.fallback === 1,
		pick: pick
			? {
					pickSide: pick.pickSide,
					scoreHomePred: pick.scoreHomePred,
					scoreAwayPred: pick.scoreAwayPred,
					updatedAt: pick.updatedAt
				}
			: null,
		points: score?.points ?? null,
		pickCount: counts.get(game.id) ?? 0
	}));
}

export class PickError extends Error {}

export interface SavePickInput {
	userId: number;
	gameId: string;
	pickSide: PickSide;
	scoreHomePred: number;
	scoreAwayPred: number;
}

/**
 * Enregistre ou met a jour un pronostic.
 *
 * Le verrouillage au kickoff est verifie ici, cote serveur, independamment de
 * l'interface (critere d'acceptation 3).
 */
export function savePick(input: SavePickInput): void {
	const game = db.select().from(games).where(eq(games.id, input.gameId)).get();
	if (!game) throw new PickError('Match inconnu.');

	const week = db.select().from(weeks).where(eq(weeks.id, game.weekId)).get();
	if (!week || week.status !== 'ouverte') {
		throw new PickError("Les pronostics de cette semaine ne sont pas ouverts.");
	}

	// Meme exception que dans `weekBoard`, revalidee ici : le verrouillage est
	// une regle serveur, l'interface ne fait que la refleter.
	if (!ignoreLeKickoff(week.testKind) && now() >= game.kickoffUtc) {
		throw new PickError('Le match a commence : ce pronostic est verrouille.');
	}
	if (game.neutralized === 1) {
		throw new PickError('Ce match est reporte ou annule.');
	}

	if (input.pickSide !== 'home' && input.pickSide !== 'away') {
		throw new PickError('Equipe choisie invalide.');
	}

	for (const value of [input.scoreHomePred, input.scoreAwayPred]) {
		if (!Number.isInteger(value) || value < 0 || value > 99) {
			throw new PickError('Les scores doivent etre des entiers entre 0 et 99.');
		}
	}

	if (
		!isPickConsistent({
			pickSide: input.pickSide,
			scoreHomePred: input.scoreHomePred,
			scoreAwayPred: input.scoreAwayPred
		})
	) {
		const picked = input.pickSide === 'home' ? game.homeAbbr : game.awayAbbr;
		throw new PickError(
			`Le score predit ne donne pas la victoire a ${picked}. Corrige le score ou change d'equipe.`
		);
	}

	const ts = now();
	db.insert(picks)
		.values({
			userId: input.userId,
			gameId: input.gameId,
			pickSide: input.pickSide,
			scoreHomePred: input.scoreHomePred,
			scoreAwayPred: input.scoreAwayPred,
			createdAt: ts,
			updatedAt: ts
		})
		.onConflictDoUpdate({
			target: [picks.userId, picks.gameId],
			set: {
				pickSide: input.pickSide,
				scoreHomePred: input.scoreHomePred,
				scoreAwayPred: input.scoreAwayPred,
				updatedAt: ts
			}
		})
		.run();
}

export interface GameDetail {
	game: typeof games.$inferSelect;
	week: typeof weeks.$inferSelect | undefined;
	/** Sans `rawJson` : la trace brute ESPN sert a l'audit, elle reste au serveur. */
	odds: Omit<typeof oddsSnapshots.$inferSelect, 'rawJson'> | undefined;
	locked: boolean;
	/** Vide tant que le match n'a pas commence (critere d'acceptation 6). */
	entries: {
		userId: number;
		pseudo: string;
		avatar: string | null;
		pickSide: PickSide;
		scoreHomePred: number;
		scoreAwayPred: number;
		points: number | null;
		bonusKind: string | null;
		correct: boolean | null;
	}[];
	missing: { userId: number; pseudo: string }[];
}

export function gameDetail(gameId: string): GameDetail | null {
	const game = db.select().from(games).where(eq(games.id, gameId)).get();
	if (!game) return null;

	const week = db.select().from(weeks).where(eq(weeks.id, game.weekId)).get();
	const oddsRow = db.select().from(oddsSnapshots).where(eq(oddsSnapshots.gameId, gameId)).get();

	// `rawJson` reste au serveur : ~4 ko de charge utile bookmaker par match,
	// jamais lue cote client, qui partait jusqu'ici dans chaque page.
	let odds: GameDetail['odds'];
	if (oddsRow) {
		const { rawJson: _auditOnly, ...rest } = oddsRow;
		odds = rest;
	}
	// Ici `locked` veut dire « les pronostics sont devoiles », pas « la saisie
	// est fermee » comme dans `weekBoard` — d'ou l'absence d'exception pour le
	// rejeu : ses kickoffs etant passes, ses pronostics sont visibles de tous,
	// ce qui est sans consequence sur une semaine hors classement.
	const locked = now() >= game.kickoffUtc;

	if (!locked) {
		return { game, week, odds, locked, entries: [], missing: [] };
	}

	const rows = db
		.select({
			userId: users.id,
			pseudo: users.pseudo,
			avatar: users.avatar,
			pick: picks,
			score: scores
		})
		.from(picks)
		.innerJoin(users, eq(users.id, picks.userId))
		.leftJoin(scores, and(eq(scores.gameId, picks.gameId), eq(scores.userId, picks.userId)))
		.where(eq(picks.gameId, gameId))
		.all();

	const entries = rows
		.map((row) => ({
			userId: row.userId,
			pseudo: row.pseudo,
			avatar: row.avatar,
			pickSide: row.pick.pickSide,
			scoreHomePred: row.pick.scoreHomePred,
			scoreAwayPred: row.pick.scoreAwayPred,
			points: row.score?.points ?? null,
			bonusKind: row.score?.bonusKind ?? null,
			correct: row.score ? row.score.correct === 1 : null
		}))
		.sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.pseudo.localeCompare(b.pseudo, 'fr'));

	const picked = new Set(entries.map((e) => e.userId));
	const missing = db
		.select({ userId: users.id, pseudo: users.pseudo })
		.from(users)
		.where(eq(users.active, 1))
		.all()
		.filter((u) => !picked.has(u.userId));

	return { game, week, odds, locked, entries, missing };
}

/** Nombre de matchs encore pronosticables et non pronostiques, par joueur. */
export function missingPicksByUser(weekId: number): { userId: number; pseudo: string; email: string; missing: number }[] {
	return sqlite
		.prepare(
			`SELECT u.id AS userId, u.pseudo, u.email,
				(SELECT COUNT(*) FROM games g
				 WHERE g.week_id = @weekId AND g.neutralized = 0 AND g.kickoff_utc > @nowTs
				   AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.game_id = g.id AND p.user_id = u.id)
				) AS missing
			 FROM users u
			 WHERE u.active = 1`
		)
		.all({ weekId, nowTs: now() }) as any[];
}
