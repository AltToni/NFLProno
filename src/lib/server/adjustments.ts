import { eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { scoreAdjustments } from './db/schema';
import { currentSeason } from './settings';
import { logger } from './logger';
import { now } from '$lib/time';

/**
 * Ajustements de points : la seule facon de corriger le total d'un joueur.
 *
 * Pourquoi une table a part plutot qu'une edition de `scores` : `scores` est
 * entierement derive. `computeGameScores` fait un DELETE puis reecrit les
 * lignes du match a partir des pronostics et du bareme fige, et ce chemin est
 * emprunte par le poll toutes les quinze minutes. Une valeur corrigee a la main
 * dans `scores` disparaitrait au premier match qui se termine.
 *
 * Un ajustement, lui, n'est jamais recalcule : il est simplement **ajoute** aux
 * totaux au moment de construire le classement. Il porte un motif, il est
 * visible des joueurs, et il se retire aussi facilement qu'il se pose.
 */

export interface AdjustmentRow {
	id: number;
	userId: number;
	pseudo: string;
	weekId: number;
	weekLabel: string;
	points: number;
	reason: string;
	createdAt: number;
	createdByPseudo: string | null;
}

const LIST = `
	SELECT a.id, a.user_id AS userId, u.pseudo, a.week_id AS weekId, w.label AS weekLabel,
		a.points, a.reason, a.created_at AS createdAt,
		(SELECT pseudo FROM users WHERE id = a.created_by) AS createdByPseudo
	FROM score_adjustments a
	JOIN users u ON u.id = a.user_id
	JOIN weeks w ON w.id = a.week_id
	WHERE w.season = @season
	ORDER BY w.seasontype, w.number, u.pseudo COLLATE NOCASE
`;

export function listAdjustments(season = currentSeason()): AdjustmentRow[] {
	return sqlite.prepare(LIST).all({ season }) as AdjustmentRow[];
}

/** Ajustements d'un joueur, pour sa fiche. */
export function playerAdjustments(userId: number, season = currentSeason()): AdjustmentRow[] {
	return listAdjustments(season).filter((row) => row.userId === userId);
}

export interface WeekAverage {
	/** Moyenne arrondie a l'entier le plus proche. */
	points: number;
	/** Nombre de joueurs sur lesquels elle est calculee. */
	players: number;
	/** Total brut, avant division — affiche pour que le calcul soit verifiable. */
	total: number;
}

/**
 * Moyenne des points marques par les *autres* joueurs sur une semaine.
 *
 * Deux choix qui meritent d'etre dits :
 *
 * - seuls les joueurs actifs **ayant reellement joue** la semaine entrent dans
 *   la moyenne. Compter un second absent a zero tirerait la compensation vers
 *   le bas sans raison ;
 * - la moyenne porte sur les points calcules (`scores`) et **ignore les
 *   ajustements deja poses**. Sans cela, compenser un deuxieme absent avec la
 *   moyenne ferait entrer la compensation du premier dans le calcul.
 *
 * Renvoie null si personne n'a joue cette semaine : il n'y a alors rien a
 * moyenner, et ecrire 0 point serait un resultat, pas une absence de resultat.
 */
export function weekAverageWithout(weekId: number, userId: number): WeekAverage | null {
	const row = sqlite
		.prepare(
			`SELECT COUNT(*) AS players, COALESCE(SUM(t.points), 0) AS total
			 FROM (
				SELECT SUM(s.points) AS points
				FROM scores s
				JOIN users u ON u.id = s.user_id
				WHERE s.week_id = @weekId AND u.active = 1 AND u.id <> @userId
				GROUP BY s.user_id
			 ) t`
		)
		.get({ weekId, userId }) as { players: number; total: number };

	if (!row || row.players === 0) return null;
	return { points: Math.round(row.total / row.players), players: row.players, total: row.total };
}

export interface AdjustmentInput {
	userId: number;
	weekId: number;
	points: number;
	reason: string;
	createdBy: number;
}

/**
 * Pose ou remplace l'ajustement d'un joueur sur une semaine. L'unicite
 * (joueur, semaine) est portee par l'index : reprendre la meme paire corrige la
 * valeur au lieu d'en empiler une seconde.
 */
export function setAdjustment(input: AdjustmentInput): void {
	if (!Number.isInteger(input.points)) {
		throw new Error('Les points d’un ajustement doivent etre un nombre entier.');
	}
	const reason = input.reason.trim();
	if (!reason) throw new Error('Un ajustement doit porter un motif : il est affiche aux joueurs.');

	db.insert(scoreAdjustments)
		.values({
			userId: input.userId,
			weekId: input.weekId,
			points: input.points,
			reason,
			createdBy: input.createdBy,
			createdAt: now()
		})
		.onConflictDoUpdate({
			target: [scoreAdjustments.userId, scoreAdjustments.weekId],
			set: { points: input.points, reason, createdBy: input.createdBy, createdAt: now() }
		})
		.run();

	logger.info(
		`Ajustement : joueur ${input.userId}, semaine ${input.weekId}, ` +
			`${input.points > 0 ? '+' : ''}${input.points} pts (${reason})`
	);
}

export function deleteAdjustment(id: number): AdjustmentRow | null {
	const row = sqlite
		.prepare(
			`SELECT a.id, a.user_id AS userId, u.pseudo, a.week_id AS weekId, w.label AS weekLabel,
				a.points, a.reason, a.created_at AS createdAt, NULL AS createdByPseudo
			 FROM score_adjustments a
			 JOIN users u ON u.id = a.user_id
			 JOIN weeks w ON w.id = a.week_id
			 WHERE a.id = @id`
		)
		.get({ id }) as AdjustmentRow | undefined;
	if (!row) return null;

	db.delete(scoreAdjustments).where(eq(scoreAdjustments.id, id)).run();
	logger.info(`Ajustement supprime : ${row.pseudo} / ${row.weekLabel} (${row.points} pts)`);
	return row;
}
