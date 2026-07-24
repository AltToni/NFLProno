/**
 * Moteur de bareme (spec section 2). Module volontairement pur : aucune
 * dependance a la base ni au reseau, il est entierement testable et sert de
 * reference unique pour le calcul comme pour l'affichage des enjeux.
 */

export interface ScoringConfig {
	k: number;
	baseMin: number;
	baseMax: number;
	marginBonusPct: number;
	exactBonusPct: number;
	drawFactor: number;
	fallbackP: number;
	playoffsEnabled: boolean;
	playoffMultipliers: Record<number, number>;
}

export const DEFAULT_SCORING: ScoringConfig = {
	k: 25,
	baseMin: 25,
	baseMax: 250,
	marginBonusPct: 0.5,
	exactBonusPct: 1,
	drawFactor: 0.5,
	fallbackP: 0.5,
	playoffsEnabled: false,
	playoffMultipliers: { 1: 1.5, 2: 2, 3: 2.5, 4: 1, 5: 3 }
};

/**
 * Moneyline americaine -> probabilite brute (marge du bookmaker incluse).
 *   ligne negative (favori)   : p = -ml / (-ml + 100)
 *   ligne positive (outsider) : p = 100 / (ml + 100)
 */
export function impliedProbabilityRaw(moneyline: number): number {
	if (!Number.isFinite(moneyline) || moneyline === 0) {
		throw new Error(`Moneyline invalide : ${moneyline}`);
	}
	return moneyline < 0 ? -moneyline / (-moneyline + 100) : 100 / (moneyline + 100);
}

/** Retrait de la marge par normalisation : p = p_raw / (p_raw_home + p_raw_away). */
export function devig(
	moneylineHome: number,
	moneylineAway: number
): { pHome: number; pAway: number } {
	const rawHome = impliedProbabilityRaw(moneylineHome);
	const rawAway = impliedProbabilityRaw(moneylineAway);
	const total = rawHome + rawAway;
	if (!(total > 0)) throw new Error('Somme des probabilites brutes nulle');
	return { pHome: rawHome / total, pAway: rawAway / total };
}

/** base = clamp(round(K / p), baseMin, baseMax) */
export function basePoints(p: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
	if (!(p > 0)) return cfg.baseMax;
	const raw = Math.round(cfg.k / p);
	return Math.min(cfg.baseMax, Math.max(cfg.baseMin, raw));
}

/** Multiplicateur de tour de playoffs (spec 2.5). seasontype 2 = saison reguliere. */
export function playoffMultiplier(
	seasontype: number,
	weekNumber: number,
	cfg: ScoringConfig = DEFAULT_SCORING
): number {
	if (!cfg.playoffsEnabled || seasontype !== 3) return 1;
	return cfg.playoffMultipliers[weekNumber] ?? 1;
}

export type PickSide = 'home' | 'away';
export type BonusKind = 'none' | 'margin' | 'exact' | 'draw';

export interface PickInput {
	pickSide: PickSide;
	scoreHomePred: number;
	scoreAwayPred: number;
}

export interface GameOutcome {
	scoreHome: number;
	scoreAway: number;
}

export interface GameBase {
	/** points de base geles au snapshot pour chaque camp */
	basePointsHome: number;
	basePointsAway: number;
	multiplier?: number;
}

export interface ScoreBreakdown {
	points: number;
	basePoints: number;
	bonusPoints: number;
	bonusKind: BonusKind;
	multiplier: number;
	correct: boolean;
	exactScore: boolean;
	exactMargin: boolean;
}

const ZERO = (multiplier: number): ScoreBreakdown => ({
	points: 0,
	basePoints: 0,
	bonusPoints: 0,
	bonusKind: 'none',
	multiplier,
	correct: false,
	exactScore: false,
	exactMargin: false
});

/**
 * Points rapportes par un pronostic sur un match termine.
 *
 * - vainqueur correct        : base
 * - + ecart exact            : +marginBonusPct x base
 * - + score exact            : +exactBonusPct x base (remplace le bonus d'ecart)
 * - vainqueur incorrect      : 0 (jamais de points negatifs)
 * - match nul                : drawFactor x base de l'equipe choisie,
 *                              ou base + bonus si le joueur avait predit le nul
 */
export function computeScore(
	pick: PickInput,
	game: GameBase,
	outcome: GameOutcome,
	cfg: ScoringConfig = DEFAULT_SCORING
): ScoreBreakdown {
	const multiplier = game.multiplier ?? 1;
	const base = pick.pickSide === 'home' ? game.basePointsHome : game.basePointsAway;

	const predDiff = pick.scoreHomePred - pick.scoreAwayPred;
	const realDiff = outcome.scoreHome - outcome.scoreAway;
	const exactScore =
		pick.scoreHomePred === outcome.scoreHome && pick.scoreAwayPred === outcome.scoreAway;
	const exactMargin = predDiff === realDiff;

	let factor: number;
	let bonusKind: BonusKind;
	let correct: boolean;

	if (realDiff === 0) {
		// Match nul : cas particulier de la spec 2.4.
		if (predDiff === 0) {
			correct = true;
			bonusKind = exactScore ? 'exact' : 'margin';
			factor = 1 + (exactScore ? cfg.exactBonusPct : cfg.marginBonusPct);
		} else {
			correct = false;
			bonusKind = 'draw';
			factor = cfg.drawFactor;
		}
	} else {
		const winner: PickSide = realDiff > 0 ? 'home' : 'away';
		if (pick.pickSide !== winner) return ZERO(multiplier);
		correct = true;
		if (exactScore) {
			bonusKind = 'exact';
			factor = 1 + cfg.exactBonusPct;
		} else if (exactMargin) {
			bonusKind = 'margin';
			factor = 1 + cfg.marginBonusPct;
		} else {
			bonusKind = 'none';
			factor = 1;
		}
	}

	const points = Math.round(base * factor * multiplier);
	const basePart = Math.round(base * Math.min(factor, 1) * multiplier);

	return {
		points,
		basePoints: basePart,
		bonusPoints: points - basePart,
		bonusKind,
		multiplier,
		correct,
		exactScore: exactScore && realDiff === predDiff,
		exactMargin
	};
}

/**
 * Enjeux affiches dans l'interface (« KC 32 pts / LV 138 pts ») a partir des
 * moneylines. Renvoie aussi le drapeau de repli quand les cotes manquent.
 */
export function stakesFromMoneylines(
	moneylineHome: number | null | undefined,
	moneylineAway: number | null | undefined,
	cfg: ScoringConfig = DEFAULT_SCORING
): {
	pHome: number;
	pAway: number;
	basePointsHome: number;
	basePointsAway: number;
	fallback: boolean;
} {
	if (
		typeof moneylineHome === 'number' &&
		typeof moneylineAway === 'number' &&
		Number.isFinite(moneylineHome) &&
		Number.isFinite(moneylineAway) &&
		moneylineHome !== 0 &&
		moneylineAway !== 0
	) {
		try {
			const { pHome, pAway } = devig(moneylineHome, moneylineAway);
			return {
				pHome,
				pAway,
				basePointsHome: basePoints(pHome, cfg),
				basePointsAway: basePoints(pAway, cfg),
				fallback: false
			};
		} catch {
			/* on retombe sur le fallback ci-dessous */
		}
	}

	const p = cfg.fallbackP;
	return {
		pHome: p,
		pAway: 1 - p,
		basePointsHome: basePoints(p, cfg),
		basePointsAway: basePoints(1 - p, cfg),
		fallback: true
	};
}

/**
 * Un pronostic doit rester coherent : le score predit ne peut pas donner la
 * victoire a l'equipe qui n'a pas ete choisie. Le nul reste autorise (spec 2.4).
 */
export function isPickConsistent(pick: PickInput): boolean {
	const diff = pick.scoreHomePred - pick.scoreAwayPred;
	if (diff === 0) return true;
	return diff > 0 ? pick.pickSide === 'home' : pick.pickSide === 'away';
}
