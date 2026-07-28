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

// ---------------------------------------------------------------------------
// Semaines de test
// ---------------------------------------------------------------------------

export type TestKind = 'rejeu' | 'simulation';

export const TEST_KIND_LABEL: Record<TestKind, string> = {
	rejeu: 'rejeu historique',
	simulation: 'simulation'
};

/**
 * Prefixe pousse dans `weeks.label`, donc porte par *toutes* les vues qui
 * affichent un libelle de semaine — onglets, entete de grille, historique du
 * joueur, page match, admin — sans avoir a les modifier une par une. Les
 * badges ajoutes dans l'interface viennent en plus, pas a la place.
 */
export const TEST_LABEL_PREFIX = 'TEST';

export function isTestWeek(testKind: string | null | undefined): boolean {
	return testKind === 'rejeu' || testKind === 'simulation';
}

/**
 * Un rejeu porte des kickoffs deja passes : appliquer le verrouillage
 * ordinaire rendrait la semaine inutilisable (aucun pronostic saisissable) et
 * la ferait cloturer avant meme qu'on ait pu pronostiquer. C'est la seule
 * exception au verrouillage, et elle ne peut jamais toucher une vraie semaine
 * puisqu'elle est conditionnee au marqueur pose a la creation.
 */
export function ignoreLeKickoff(testKind: string | null | undefined): boolean {
	return testKind === 'rejeu';
}
