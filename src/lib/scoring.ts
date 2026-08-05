/**
 * Moteur de bareme (spec section 2). Module volontairement pur : aucune
 * dependance a la base ni au reseau, il est entierement testable et sert de
 * reference unique pour le calcul comme pour l'affichage des enjeux.
 */

import TABLE_ECARTS from './ecarts-nfl.json';

export interface ScoringConfig {
	k: number;
	baseMin: number;
	baseMax: number;
	marginBonusPct: number;
	exactBonusPct: number;
	drawFactor: number;
	fallbackP: number;
	/** Numerateur du bonus de rarete : bonus = bonusK / f(ecart). */
	bonusK: number;
	/** Bornes du bonus de rarete, en fraction des points de base. */
	bonusPlancher: number;
	bonusPlafond: number;
	/** Perte de bonus par point d'erreur sur l'ecart (mode ecart). */
	bonusPas: number;
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
	bonusK: TABLE_ECARTS.k,
	bonusPlancher: TABLE_ECARTS.plancher,
	bonusPlafond: TABLE_ECARTS.plafond,
	bonusPas: 0.25,
	playoffsEnabled: false,
	playoffMultipliers: { 1: 1.5, 2: 2, 3: 2.5, 4: 1, 5: 3 }
};

// ---------------------------------------------------------------------------
// Rarete des ecarts
// ---------------------------------------------------------------------------

/**
 * Frequence historique de chaque ecart, produite par
 * `scripts/analyse-ecarts.ts` sur 2015-2025 et **figee dans le depot**.
 *
 * Elle n'est pas recalculee en cours de saison : un bareme qui bouge sous les
 * joueurs n'est plus un bareme. La regenerer est un geste explicite, qui
 * demande de relancer le script et de commiter la table.
 */
export const ECARTS = TABLE_ECARTS;

/** Dernier seau de la table : « `ecartMax` ou plus ». */
export const ECART_MAX = TABLE_ECARTS.ecartMax;

/**
 * Frequence de l'ecart `m`. Tout ce qui depasse la table retombe sur son
 * dernier seau : au-dela, chaque valeur prise isolement est trop rare pour
 * porter une frequence propre, et un ecart de 34 points n'est pas plus
 * previsible qu'un de 31.
 */
export function frequenceEcart(m: number): number {
	if (!Number.isFinite(m) || m < 0) return TABLE_ECARTS.frequences[ECART_MAX];
	return TABLE_ECARTS.frequences[Math.min(Math.round(m), ECART_MAX)];
}

/**
 * Bonus obtenu si l'ecart annonce tombe **pile**, en fraction des points de
 * base : `clamp(k / f(m), plancher, plafond)`.
 *
 * Autrement dit : plus l'ecart vise est improbable, plus il rapporte. Un
 * match gagne de 3 points est le resultat le plus courant du football
 * americain (un panier de la victoire) et ne vaut presque rien ; un nul, dix
 * fois sur 2895 matchs, vaut le plafond.
 *
 * `k` est calibre par le script pour que le bonus **moyen**, pondere par la
 * frequence reelle des ecarts, vaille 100 % : le bareme redistribue, il
 * n'inflate pas.
 */
export function bonusEcartExact(m: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
	const f = frequenceEcart(m);
	if (!(f > 0)) return cfg.bonusPlafond;
	return Math.min(cfg.bonusPlafond, Math.max(cfg.bonusPlancher, cfg.bonusK / f));
}

/**
 * Part du bonus conservee quand l'ecart est rate : 1 a l'exact, puis `pas` de
 * moins par point d'erreur, plancher a 0. Avec le pas par defaut de 0,25, un
 * ecart rate de 4 points ou plus ne rapporte plus rien.
 */
export function attenuationEcart(erreur: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
	return Math.max(0, 1 - cfg.bonusPas * Math.abs(erreur));
}

/** Bonus effectivement accorde, rarete et erreur combinees. */
export function bonusEcart(
	mPredit: number,
	mReel: number,
	cfg: ScoringConfig = DEFAULT_SCORING
): number {
	return bonusEcartExact(mPredit, cfg) * attenuationEcart(mPredit - mReel, cfg);
}

/**
 * Ecarts les plus frequents, proposes en raccourci a la saisie. Ce ne sont
 * plus des choix imposes — n'importe quel entier est jouable — seulement les
 * boutons qui evitent de taper les cas courants.
 */
export const ECARTS_COURANTS = [3, 7, 6, 10, 14, 4] as const;

/** Ecart d'un nul predit : aucune equipe n'est designee. */
export const DRAW_MARGIN = 0;

/** Borne haute de saisie : au-dela, c'est une faute de frappe. */
export const MARGIN_MAX = 60;

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
export type BonusKind = 'none' | 'margin' | 'near' | 'exact' | 'draw';

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
	/**
	 * Split predit : une valeur de `SPLIT_CHOICES` avec une equipe, 0 pour un
	 * nul. Les pronostics anterieurs a la liste fermee peuvent porter n'importe
	 * quel entier ; le calcul ci-dessous les traite sans cas particulier.
	 */
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
	/** Split rate d'un point, bonus partiel obtenu. Exclusif de `exactMargin`. */
	nearMargin: boolean;
}

const ZERO = (multiplier: number): ScoreBreakdown => ({
	points: 0,
	basePoints: 0,
	bonusPoints: 0,
	bonusKind: 'none',
	multiplier,
	correct: false,
	exactScore: false,
	exactMargin: false,
	nearMargin: false
});

/**
 * Points rapportes par un pronostic sur un match termine.
 *
 * - vainqueur correct, mode ecart : base x (1 + bonus de rarete attenue)
 * - vainqueur correct, mode score : base, +marginBonusPct si l'ecart est
 *                                   exact, +exactBonusPct si le score l'est
 * - vainqueur incorrect           : 0 (jamais de points negatifs)
 * - match nul                     : drawFactor x base de l'equipe choisie,
 *                                   ou base + bonus si le nul etait predit
 *
 * **Le bonus de rarete est reserve au mode ecart.** C'est la contrepartie de
 * sa contrainte : annoncer un ecart, c'est s'engager sur une valeur precise,
 * et le bareme paie a proportion de l'improbabilite de cette valeur. Le mode
 * score, lui, garde son bareme forfaitaire — l'ecart y est un sous-produit du
 * score annonce, et le x2 du score exact est deja sa recompense propre.
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

	/**
	 * Bonus de rarete du mode ecart. Les deux grandeurs sont des **ecarts
	 * absolus** : le vainqueur ayant deja ete verifie, `predDiff` et `realDiff`
	 * sont de meme signe, et c'est bien l'ecart annonce qui est note.
	 */
	const bonusRarete = (): number =>
		bonusEcart(Math.abs(predDiff), Math.abs(realDiff), cfg);

	let factor: number;
	let bonusKind: BonusKind;
	let correct: boolean;

	if (realDiff === 0) {
		// Match nul : cas particulier de la spec 2.4.
		if (predDiff === 0) {
			correct = true;
			if (pick.mode === 'margin') {
				// Le nul est l'issue la plus rare du football americain : il touche
				// le bonus le plus eleve de la table, par le meme mecanisme que
				// n'importe quel autre ecart.
				bonusKind = 'margin';
				factor = 1 + bonusRarete();
			} else {
				bonusKind = exactScore ? 'exact' : 'margin';
				factor = 1 + (exactScore ? cfg.exactBonusPct : cfg.marginBonusPct);
			}
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

		if (pick.mode === 'margin') {
			const bonus = bonusRarete();
			factor = 1 + bonus;
			bonusKind = exactMargin ? 'margin' : bonus > 0 ? 'near' : 'none';
		} else if (exactScore) {
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
		exactMargin,
		nearMargin: bonusKind === 'near'
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
 *  - mode `'margin'` : un ecart strictement positif designe une equipe, un
 *    ecart de 0 (nul predit) n'en designe aucune.
 *
 * L'ecart est un entier libre entre 0 et `MARGIN_MAX`. La liste fermee de huit
 * splits qui existait auparavant garantissait qu'un ecart reel n'etait proche
 * que d'un seul choix ; le bonus de rarete rend cette garantie inutile, chaque
 * valeur ayant desormais son propre bareme.
 *
 * Regle de reference, partagee par le controle serveur (`savePick`, qui affine
 * seulement le message d'erreur) et par l'interface.
 */
export function isPickConsistent(pick: PickInput): boolean {
	if (pick.mode === 'margin') {
		if (!Number.isInteger(pick.marginPred) || pick.marginPred < 0) return false;
		if (pick.marginPred > MARGIN_MAX) return false;
		if (pick.marginPred === DRAW_MARGIN) return pick.pickSide === null;
		return pick.pickSide !== null;
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
