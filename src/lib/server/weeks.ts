import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { weeks, games } from './db/schema';
import { weekLabel } from '$lib/nfl';
import { currentSeason } from './settings';
import type { Week } from './db/schema';

export function ensureWeek(season: number, seasontype: number, number: number): Week {
	const existing = db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), eq(weeks.seasontype, seasontype), eq(weeks.number, number)))
		.get();
	if (existing) return existing;

	db.insert(weeks)
		.values({
			season,
			seasontype,
			number,
			label: weekLabel(seasontype, number),
			status: 'a_venir'
		})
		.onConflictDoNothing()
		.run();

	return db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), eq(weeks.seasontype, seasontype), eq(weeks.number, number)))
		.get()!;
}

export function getWeekById(id: number): Week | undefined {
	return db.select().from(weeks).where(eq(weeks.id, id)).get();
}

export function listWeeks(season = currentSeason()): Week[] {
	return db
		.select()
		.from(weeks)
		.where(eq(weeks.season, season))
		.orderBy(asc(weeks.seasontype), asc(weeks.number))
		.all();
}

/**
 * Semaines deja jouables ou jouees, de la plus recente a la plus ancienne.
 *
 * Les semaines de test restent visibles — c'est bien le but, il faut pouvoir
 * ouvrir la grille — mais passent en fin de liste : leur numero reserve (90+)
 * les placerait sinon en tete des onglets, devant la semaine en cours.
 */
export function listVisibleWeeks(season = currentSeason()): Week[] {
	return db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), inArray(weeks.status, ['ouverte', 'cloturee'])))
		.orderBy(sql`${weeks.testKind} IS NULL DESC`, desc(weeks.seasontype), desc(weeks.number))
		.all();
}

/**
 * Semaine affichee par defaut : la derniere semaine ouverte, sinon la derniere
 * semaine cloturee.
 *
 * Jamais une semaine de test : creer un bac a sable ne doit pas deplacer la
 * page d'accueil des joueurs ni la cible du rappel du jeudi. On y accede par
 * son onglet, explicitement.
 */
export function currentWeek(season = currentSeason()): Week | undefined {
	const open = db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), isNull(weeks.testKind), eq(weeks.status, 'ouverte')))
		.orderBy(desc(weeks.seasontype), desc(weeks.number))
		.get();
	if (open) return open;

	return db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), isNull(weeks.testKind), eq(weeks.status, 'cloturee')))
		.orderBy(desc(weeks.seasontype), desc(weeks.number))
		.get();
}

export function weekGames(weekId: number) {
	return db.select().from(games).where(eq(games.weekId, weekId)).orderBy(asc(games.kickoffUtc)).all();
}
