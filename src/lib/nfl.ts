import { pickInputFromRow, predictedDiff, type PickSide } from './scoring';

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

// ---------------------------------------------------------------------------
// Libelles des pronostics
// ---------------------------------------------------------------------------

/** Libelle du bonus obtenu, partage par la page match et le profil joueur. */
export const BONUS_LABEL: Record<string, string> = {
	none: '',
	margin: 'ecart exact',
	near: 'ecart approche',
	draw: 'match nul'
};

/** Ce qu'un pronostic doit contenir pour etre affichable. */
export interface PickShape {
	pickSide: PickSide | null;
	marginPred: number | null;
}

/**
 * Forme lisible d'un ecart signe : « KC +7 », « LV +3 », « Match nul ». Sert
 * aussi bien a l'apercu de la saisie qu'a l'affichage des pronostics des autres
 * joueurs.
 */
export function marginLabel(diff: number, homeAbbr: string, awayAbbr: string): string {
	if (diff === 0) return 'Match nul';
	return diff > 0 ? `${homeAbbr} +${diff}` : `${awayAbbr} +${-diff}`;
}

/** Le pronostic tel qu'il a ete saisi : « KC +7 », ou « Match nul ». */
export function pickLabel(pick: PickShape, homeAbbr: string, awayAbbr: string): string {
	return marginLabel(predictedDiff(pickInputFromRow(pick)), homeAbbr, awayAbbr);
}

/**
 * Bonus reellement applique, relu depuis les points **stockes**.
 *
 * On ne recalcule pas depuis le bareme courant : celui-ci a pu etre modifie
 * apres coup, et la ligne afficherait alors une explication qui ne correspond
 * plus aux points inscrits au classement. Le quotient, lui, est toujours
 * d'accord avec eux.
 */
export function bonusApplique(
	basePoints: number | null | undefined,
	bonusPoints: number | null | undefined
): number | null {
	if (typeof basePoints !== 'number' || typeof bonusPoints !== 'number') return null;
	if (basePoints <= 0 || bonusPoints <= 0) return null;
	return bonusPoints / basePoints;
}

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
