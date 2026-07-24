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
	pick: {
		pickSide: PickSide;
		scoreHomePred: number;
		scoreAwayPred: number;
		updatedAt: number;
	} | null;
	points: number | null;
	pickCount: number;
}

export interface StandingRow {
	userId: number;
	pseudo: string;
	avatar: string | null;
	points: number;
	exactScores: number;
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
