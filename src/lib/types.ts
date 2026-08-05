import type { PickSide } from './scoring';

/**
 * Types partages entre le serveur et les composants. Volontairement hors de
 * `$lib/server` : les composants ne doivent jamais importer un module serveur.
 */

export interface BoardGame {
	id: string;
	homeAbbr: string;
	homeName: string;
	homeLogo: string | null;
	awayAbbr: string;
	awayName: string;
	awayLogo: string | null;
	kickoffUtc: number;
	status: string;
	statusDetail: string | null;
	scoreHome: number | null;
	scoreAway: number | null;
	neutralized: boolean;
	locked: boolean;
	basePointsHome: number | null;
	basePointsAway: number | null;
	pHome: number | null;
	pAway: number | null;
	fallbackOdds: boolean;
	/** Le pronostic enregistre : l'equipe designee et l'ecart annonce. */
	pick: {
		pickSide: PickSide | null;
		marginPred: number | null;
		updatedAt: number;
	} | null;
	points: number | null;
	/** Decomposition des points acquis, pour afficher le calcul une fois final. */
	basePoints: number | null;
	bonusPoints: number | null;
	pickCount: number;
}

/**
 * Etat de saisie d'une carte, remonte par `GameCard` a la page `/pronostics`.
 * La carte ne connait pas la grille ; la page ne connait pas la saisie en cours.
 * Ces trois booleens sont tout ce qui passe entre les deux, et c'est ce qui
 * permet au bouton d'enregistrement unique de savoir quoi ecrire et quoi
 * signaler.
 */
export interface EtatCarte {
	/** Rien du tout n'a ete saisi. */
	vide: boolean;
	/** Assez saisi pour etre enregistrable. */
	complet: boolean;
	/** Different de ce que le serveur a en base. */
	modifie: boolean;
}

/**
 * Icones disponibles dans `Icon.svelte`. Le type vit ici plutot que dans le
 * composant : un `<script lang="ts">` d'instance n'exporte pas ses types, et
 * la navigation a besoin de nommer une icone dans sa table d'entrees.
 */
export type IconName =
	| 'accueil'
	| 'ballon'
	| 'trophee'
	| 'stats'
	| 'reglages'
	| 'bouclier'
	| 'couronne'
	| 'check'
	| 'croix'
	| 'calendrier'
	| 'chevron-droite'
	| 'chevron-gauche'
	| 'livre'
	| 'sortie';

export interface StandingRow {
	userId: number;
	pseudo: string;
	avatar: string | null;
	points: number;
	exactMargins: number;
	corrects: number;
	played: number;
	rank: number;
	successRate: number;
	averagePoints: number;
}

export interface EvolutionPoint {
	weekId: number;
	label: string;
	rank: number;
	points: number;
	cumulative: number;
}

export interface EvolutionSeries {
	userId: number;
	pseudo: string;
	points: EvolutionPoint[];
}
