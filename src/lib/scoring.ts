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

/**
 * Deux facons de saisir un pronostic, au choix du joueur match par match :
 *
 *  - `'score'`  : les deux scores predits. Le vainqueur et l'ecart s'en
 *    deduisent, et c'est le seul mode eligible au bonus de score exact (x2).
 *  - `'margin'` : vainqueur + ecart de points (>= 1), ou match nul (ecart 0,
 *    aucune equipe designee). Aucun score n'est predit, donc le x2 est hors
 *    d'atteinte par construction.
 */
export type PickMode = 'score' | 'margin';

/**
 * `pickSide` reste nullable dans les deux modes : le schema l'autorise depuis
 * l'arrivee du nul predit sans equipe (mode `'margin'`, ecart 0). Un pronostic
 * en mode `'score'` sans equipe est refuse a l'ecriture (`savePick`) ; s'il en
 * arrivait un ici, il vaudrait 0 des que le match a un vainqueur.
 */
export interface ScorePick {
	mode?: 'score';
	pickSide: PickSide | null;
	scoreHomePred: number;
	scoreAwayPred: number;
}

export interface MarginPick {
	mode: 'margin';
	/** null si et seulement si `marginPred` vaut 0 (nul predit). */
	pickSide: PickSide | null;
	/** Ecart absolu predit : >= 1 avec une equipe, 0 pour un nul. */
	marginPred: number;
}

export type PickInput = ScorePick | MarginPick;

/**
 * Ecart signe predit — positif = victoire des locaux — quel que soit le mode
 * de saisie. C'est la grandeur commune aux deux modes, et donc le pivot du
 * calcul : le bonus d'ecart se lit pareil de part et d'autre.
 */
export function predictedDiff(pick: PickInput): number {
	if (pick.mode === 'margin') {
		if (pick.pickSide === null) return 0;
		return pick.pickSide === 'home' ? pick.marginPred : -pick.marginPred;
	}
	return pick.scoreHomePred - pick.scoreAwayPred;
}

/**
 * Points de base en jeu pour un camp. Un nul predit en mode `'margin'` ne
 * designe aucune equipe : le bareme retenu est alors la moyenne des deux, seule
 * valeur neutre disponible (cf. README section 4, interpretation 3).
 */
export function stakePoints(side: PickSide | null, game: GameBase): number {
	if (side === 'home') return game.basePointsHome;
	if (side === 'away') return game.basePointsAway;
	return Math.round((game.basePointsHome + game.basePointsAway) / 2);
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
 *
 * Les deux modes de saisie partagent ce calcul : seul l'ecart signe predit
 * change de source, et le mode `'margin'` n'ayant pas de score predit, il
 * n'atteint jamais le bonus de score exact.
 */
export function computeScore(
	pick: PickInput,
	game: GameBase,
	outcome: GameOutcome,
	cfg: ScoringConfig = DEFAULT_SCORING
): ScoreBreakdown {
	const multiplier = game.multiplier ?? 1;
	const base = stakePoints(pick.pickSide, game);

	const predDiff = predictedDiff(pick);
	const realDiff = outcome.scoreHome - outcome.scoreAway;
	const exactScore =
		pick.mode !== 'margin' &&
		pick.scoreHomePred === outcome.scoreHome &&
		pick.scoreAwayPred === outcome.scoreAway;
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
		// `pickSide` null (nul predit en mode « ecart ») tombe ici aussi : sans
		// equipe designee, un match avec vainqueur ne rapporte rien.
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
 * Un pronostic doit rester coherent, dans un mode comme dans l'autre :
 *
 *  - mode `'score'`  : le score predit ne peut pas donner la victoire a
 *    l'equipe qui n'a pas ete choisie. Le nul reste autorise (spec 2.4).
 *  - mode `'margin'` : un ecart de 1 point ou plus designe une equipe, un ecart
 *    de 0 (nul predit) n'en designe aucune.
 *
 * Regle de reference, partagee par le controle serveur (`savePick`, qui affine
 * seulement le message d'erreur) et par l'interface.
 */
export function isPickConsistent(pick: PickInput): boolean {
	if (pick.mode === 'margin') {
		if (!Number.isInteger(pick.marginPred) || pick.marginPred < 0) return false;
		return pick.marginPred === 0 ? pick.pickSide === null : pick.pickSide !== null;
	}
	const diff = pick.scoreHomePred - pick.scoreAwayPred;
	if (diff === 0) return true;
	return diff > 0 ? pick.pickSide === 'home' : pick.pickSide === 'away';
}

/**
 * Ligne `picks` (ou toute forme equivalente) vers une entree de calcul. Le
 * schema autorise des colonnes vides — les scores en mode « ecart », l'ecart en
 * mode « score » — et c'est ici, en un seul endroit, qu'on retombe sur des
 * valeurs sures plutot que dans chaque appelant.
 */
export function pickInputFromRow(row: {
	mode: string | null;
	pickSide: PickSide | null;
	scoreHomePred: number | null;
	scoreAwayPred: number | null;
	marginPred: number | null;
}): PickInput {
	if (row.mode === 'margin') {
		const marginPred = row.marginPred ?? 0;
		return { mode: 'margin', pickSide: marginPred === 0 ? null : row.pickSide, marginPred };
	}
	return {
		mode: 'score',
		pickSide: row.pickSide,
		scoreHomePred: row.scoreHomePred ?? 0,
		scoreAwayPred: row.scoreAwayPred ?? 0
	};
}
