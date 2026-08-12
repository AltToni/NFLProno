import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { weeks } from './db/schema';
import { SEASONTYPE_PRESEASON } from '$lib/nfl';
import { compterSemaine, purgerSemaines, type PurgeReport } from './purge';
import { currentSeason } from './settings';
import type { Week } from './db/schema';

/**
 * Semaines de presaison : les trois semaines d'aout, jouees pour de vrai.
 *
 * Ce ne sont pas des semaines de test. Elles portent de vrais matchs, de vraies
 * cotes, un vrai verrouillage au kickoff, et leurs points comptent au classement
 * general — c'est ce qui en fait un galop d'essai credible pour recruter des
 * joueurs. La contrepartie est la remise a zero : avant la semaine 1 de la
 * saison reguliere, l'admin les supprime, et le classement repart de zero pour
 * tout le monde.
 *
 * Ce qui survit a la remise a zero : les comptes, les invitations, les reglages
 * du bareme. Ce qui disparait : les semaines de presaison, leurs matchs, leurs
 * baremes figes, les pronostics et les points qui vont avec.
 */

export interface PreseasonWeekSummary {
	week: Week;
	games: number;
	picks: number;
	scores: number;
}

export function listPreseasonWeeks(season = currentSeason()): PreseasonWeekSummary[] {
	const rows = db
		.select()
		.from(weeks)
		.where(
			and(
				eq(weeks.season, season),
				eq(weeks.seasontype, SEASONTYPE_PRESEASON),
				// Une semaine de test est rangee sous le type « reguliere », donc hors
				// de portee ici ; le filtre le dit quand meme, pour que la remise a
				// zero ne puisse jamais emporter un bac a sable par surprise.
				isNull(weeks.testKind)
			)
		)
		.orderBy(weeks.number)
		.all();

	return rows.map((week) => ({ week, ...compterSemaine(week.id) }));
}

/** Remise a zero d'avant-saison : supprime la presaison et tout ce qui en depend. */
export function purgePreseasonWeeks(season = currentSeason()): PurgeReport {
	if (!Number.isInteger(season)) throw new Error(`Saison invalide : ${season}`);

	return purgerSemaines(
		`season = ${season} AND seasontype = ${SEASONTYPE_PRESEASON} AND test_kind IS NULL`,
		`presaison ${season}`
	);
}
