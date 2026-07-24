export const SEASONTYPE_REGULAR = 2;
export const SEASONTYPE_PLAYOFFS = 3;

const PLAYOFF_LABELS: Record<number, string> = {
	1: 'Wild Card',
	2: 'Divisional',
	3: 'Finales de conference',
	4: 'Pro Bowl',
	5: 'Super Bowl'
};

export function weekLabel(seasontype: number, number: number): string {
	if (seasontype === SEASONTYPE_PLAYOFFS) {
		return PLAYOFF_LABELS[number] ?? `Playoffs - tour ${number}`;
	}
	return `Semaine ${number}`;
}

export function weekShortLabel(seasontype: number, number: number): string {
	if (seasontype === SEASONTYPE_PLAYOFFS) {
		const long = PLAYOFF_LABELS[number] ?? `T${number}`;
		return long === 'Finales de conference' ? 'Conf.' : long === 'Super Bowl' ? 'SB' : long;
	}
	return `S${number}`;
}

export const WEEK_STATUS_LABEL: Record<string, string> = {
	a_venir: 'a venir',
	ouverte: 'ouverte',
	cloturee: 'cloturee'
};

export const GAME_STATUS_LABEL: Record<string, string> = {
	scheduled: 'a venir',
	in: 'en cours',
	final: 'termine',
	postponed: 'reporte',
	canceled: 'annule'
};

/** Le classement d'un match est fige des le kickoff. */
export function isLocked(kickoffUtc: number, nowSeconds: number): boolean {
	return nowSeconds >= kickoffUtc;
}
