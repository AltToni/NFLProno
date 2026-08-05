import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SCORING,
	basePoints,
	computeScore,
	devig,
	impliedProbabilityRaw,
	bonusEcart,
	bonusEcartExact,
	ECART_MAX,
	ECARTS,
	frequenceEcart,
	isPickConsistent,
	MARGIN_MAX,
	pickInputFromRow,
	playoffMultiplier,
	predictedDiff,
	stakePoints,
	stakesFromMoneylines,
	type ScoringConfig
} from './scoring';

const cfg = DEFAULT_SCORING;

describe('probabilite implicite', () => {
	it('convertit une ligne de favori', () => {
		// -200 -> 200 / 300
		expect(impliedProbabilityRaw(-200)).toBeCloseTo(0.6667, 4);
	});

	it('convertit une ligne d’outsider', () => {
		// +170 -> 100 / 270
		expect(impliedProbabilityRaw(170)).toBeCloseTo(0.3704, 4);
	});

	it('refuse une ligne nulle', () => {
		expect(() => impliedProbabilityRaw(0)).toThrow();
	});
});

describe('de-vig', () => {
	it('normalise a 1', () => {
		const { pHome, pAway } = devig(-200, 170);
		expect(pHome + pAway).toBeCloseTo(1, 10);
		expect(pHome).toBeCloseTo(0.6429, 3);
		expect(pAway).toBeCloseTo(0.3571, 3);
	});

	it('retire bien la marge (la somme brute depassait 1)', () => {
		const raw = impliedProbabilityRaw(-200) + impliedProbabilityRaw(170);
		expect(raw).toBeGreaterThan(1);
	});
});

describe('points de base', () => {
	// Exemples explicites de la spec, section 2.2
	it.each([
		[0.8, 31],
		[0.5, 50],
		[0.35, 71],
		[0.2, 125],
		[0.1, 250]
	])('p = %s donne %i points', (p, expected) => {
		expect(basePoints(p, cfg)).toBe(expected);
	});

	it('plafonne a 250 sous 10 %', () => {
		expect(basePoints(0.05, cfg)).toBe(250);
		expect(basePoints(0.01, cfg)).toBe(250);
	});

	it('plancher a 25 pour un archi-favori', () => {
		expect(basePoints(0.99, cfg)).toBe(25);
		expect(basePoints(1, cfg)).toBe(25);
	});
});

describe('enjeux affiches', () => {
	it('derive les deux baremes des moneylines', () => {
		const stakes = stakesFromMoneylines(-380, 300, cfg);
		expect(stakes.fallback).toBe(false);
		expect(stakes.pHome + stakes.pAway).toBeCloseTo(1, 10);
		expect(stakes.basePointsHome).toBeLessThan(stakes.basePointsAway);
	});

	it('retombe sur 50/50 quand les cotes manquent', () => {
		const stakes = stakesFromMoneylines(null, null, cfg);
		expect(stakes.fallback).toBe(true);
		expect(stakes.basePointsHome).toBe(50);
		expect(stakes.basePointsAway).toBe(50);
	});

	it('retombe aussi si une seule moneyline est presente', () => {
		expect(stakesFromMoneylines(-150, undefined, cfg).fallback).toBe(true);
	});
});

const GAME = { basePointsHome: 31, basePointsAway: 125 };

describe('calcul des points', () => {
	// Reel +4 (24-20) : l'ecart annonce decide du bonus, pas du vainqueur.
	const REEL = { scoreHome: 24, scoreAway: 20 };

	it('vainqueur correct, ecart trop loin : la base, sans bonus', () => {
		const r = computeScore({ pickSide: 'home', marginPred: 12 }, GAME, REEL, cfg);
		expect(r.points).toBe(31);
		expect(r.bonusKind).toBe('none');
		expect(r.correct).toBe(true);
	});

	it('vainqueur incorrect : zero, jamais de negatif', () => {
		const r = computeScore({ pickSide: 'away', marginPred: 4 }, GAME, REEL, cfg);
		expect(r.points).toBe(0);
		expect(r.correct).toBe(false);
	});

	it('ecart exact : le bonus de rarete tombe plein', () => {
		const r = computeScore({ pickSide: 'home', marginPred: 4 }, GAME, REEL, cfg);
		expect(r.points).toBe(56); // round(31 x 1,803)
		expect(r.bonusKind).toBe('margin');
		expect(r.exactMargin).toBe(true);
	});

	it('detail base + bonus coherent avec le total', () => {
		const r = computeScore({ pickSide: 'home', marginPred: 4 }, GAME, REEL, cfg);
		expect(r.basePoints).toBe(31);
		expect(r.bonusPoints).toBe(25);
		expect(r.basePoints + r.bonusPoints).toBe(r.points);
	});

	it('recompense l’outsider a proportion de son enjeu', () => {
		// LV vaut 125 pts : le meme ecart exact y rapporte quatre fois plus.
		const r = computeScore({ pickSide: 'away', marginPred: 4 }, GAME, { scoreHome: 20, scoreAway: 24 }, cfg);
		expect(r.points).toBe(225); // round(125 x 1,803)
		expect(r.correct).toBe(true);
	});
});

describe('match nul', () => {
	const NUL = { scoreHome: 20, scoreAway: 20 };

	it('donne 50 % des points de base de l’equipe choisie', () => {
		const r = computeScore({ pickSide: 'away', marginPred: 7 }, GAME, NUL, cfg);
		expect(r.points).toBe(63); // round(125 x 0,5)
		expect(r.bonusKind).toBe('draw');
		expect(r.correct).toBe(false);
	});

	it('recompense le joueur qui avait predit un nul', () => {
		const r = computeScore({ pickSide: null, marginPred: 0 }, GAME, NUL, cfg);
		// Enjeu neutre (moyenne des deux baremes) et bonus au plafond.
		expect(r.points).toBe(Math.round(78 * (1 + cfg.bonusPlafond)));
		expect(r.bonusKind).toBe('margin');
		expect(r.correct).toBe(true);
	});
});

describe('vainqueur + ecart', () => {
	// GAME : 31 pts cote locaux, 125 cote visiteurs. Un nul predit ne designant
	// aucune equipe, son enjeu est la moyenne des deux : round(156 / 2) = 78.
	const ENJEU_NUL = 78;
	const SIX = { scoreHome: 24, scoreAway: 18 }; // locaux +6

	it('paie peu un ecart banal, meme touche pile', () => {
		// +3 est l'ecart le plus frequent du football americain (14,6 % des
		// matchs) : son bonus est proche du plancher.
		const r = computeScore(
			{ pickSide: 'home', marginPred: 3 },
			GAME,
			{ scoreHome: 21, scoreAway: 18 },
			cfg
		);
		expect(bonusEcartExact(3, cfg)).toBeCloseTo(0.2576, 3);
		expect(r.points).toBe(39); // round(31 x 1,2576)
		expect(r.bonusKind).toBe('margin');
		expect(r.exactMargin).toBe(true);
		expect(r.correct).toBe(true);
	});

	it('paie le plafond un ecart rare touche pile', () => {
		// +12 ne sort que dans 1,8 % des matchs : k / f depasse le plafond.
		const r = computeScore(
			{ pickSide: 'home', marginPred: 12 },
			GAME,
			{ scoreHome: 30, scoreAway: 18 },
			cfg
		);
		expect(bonusEcartExact(12, cfg)).toBe(cfg.bonusPlafond);
		expect(r.points).toBe(93); // round(31 x 3)
		expect(r.bonusKind).toBe('margin');
		expect(r.basePoints + r.bonusPoints).toBe(r.points);
	});

	it("le bonus decroit d'un quart par point d'erreur, puis s'eteint", () => {
		const annonce = { pickSide: 'home' as const, marginPred: 6 };
		const pointsPour = (reel: number) =>
			computeScore(annonce, GAME, { scoreHome: 18 + reel, scoreAway: 18 }, cfg).points;

		expect(pointsPour(6)).toBe(48); // pile     : bonus plein
		expect(pointsPour(7)).toBe(44); // erreur 1 : trois quarts
		expect(pointsPour(5)).toBe(44); // symetrique
		expect(pointsPour(8)).toBe(39); // erreur 2 : moitie
		expect(pointsPour(9)).toBe(35); // erreur 3 : un quart
		expect(pointsPour(10)).toBe(31); // erreur 4 : plus rien, la base reste
		expect(pointsPour(14)).toBe(31); // au-dela, toujours rien de plus
	});

	it('classe le bonus obtenu : exact, partiel, ou aucun', () => {
		const annonce = { pickSide: 'home' as const, marginPred: 6 };
		const kind = (reel: number) =>
			computeScore(annonce, GAME, { scoreHome: 18 + reel, scoreAway: 18 }, cfg).bonusKind;
		expect(kind(6)).toBe('margin');
		expect(kind(7)).toBe('near');
		expect(kind(10)).toBe('none');
	});

	it('mauvais vainqueur : zero, meme avec le bon ecart', () => {
		const r = computeScore({ pickSide: 'away', marginPred: 6 }, GAME, SIX, cfg);
		expect(r.points).toBe(0);
		expect(r.correct).toBe(false);
	});

	it('nul predit et match nul : le plafond, sur la moyenne des deux baremes', () => {
		// Le nul est l'issue la plus rare du jeu (0,35 % des matchs) : son bonus
		// est au plafond, et c'est le plus gros gain unitaire du bareme.
		const r = computeScore(
			{ pickSide: null, marginPred: 0 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(bonusEcartExact(0, cfg)).toBe(cfg.bonusPlafond);
		expect(r.points).toBe(Math.round(ENJEU_NUL * 3)); // 234
		expect(r.bonusKind).toBe('margin');
		expect(r.correct).toBe(true);
		expect(r.exactMargin).toBe(true);
	});

	it('nul predit et match avec vainqueur : zero, aucune equipe a crediter', () => {
		const r = computeScore(
			{ pickSide: null, marginPred: 0 },
			GAME,
			{ scoreHome: 24, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(0);
		expect(r.correct).toBe(false);
	});

	it('equipe choisie et match nul : 50 % de son bareme', () => {
		const away = computeScore(
			{ pickSide: 'away', marginPred: 6 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(away.points).toBe(63); // round(125 x 0,5)
		expect(away.bonusKind).toBe('draw');
		expect(away.correct).toBe(false);
	});

	it("un nul reel n'est jamais un ecart « rate de peu »", () => {
		// Annonce +1 sur un match qui finit nul : c'est le mauvais resultat, pas
		// une quasi-reussite. La branche du nul l'emporte sur l'attenuation.
		const r = computeScore(
			{ pickSide: 'home', marginPred: 1 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(r.bonusKind).toBe('draw');
		expect(r.points).toBe(16); // round(31 x 0,5)
	});

	it('suit le multiplicateur de playoffs', () => {
		const r = computeScore(
			{ pickSide: 'home', marginPred: 6 },
			{ ...GAME, multiplier: 2 },
			SIX,
			{ ...cfg, playoffsEnabled: true }
		);
		expect(r.points).toBe(96); // round(31 x 1,5433 x 2)
	});

	it('deux appels identiques donnent le meme resultat', () => {
		const args = [
			{ pickSide: 'home' as const, marginPred: 6 },
			GAME,
			SIX,
			cfg
		] as const;
		expect(computeScore(...args)).toEqual(computeScore(...args));
	});
});

describe('bonus de rarete', () => {
	it('rend un bonus decroissant avec la frequence', () => {
		// L'ordre des bonus doit etre exactement l'inverse de celui des
		// frequences : c'est toute la promesse faite au joueur.
		const ecarts = [3, 7, 6, 10, 17, 21];
		const parFrequence = [...ecarts].sort((a, b) => frequenceEcart(b) - frequenceEcart(a));
		const parBonus = [...ecarts].sort((a, b) => bonusEcartExact(a, cfg) - bonusEcartExact(b, cfg));
		expect(parBonus).toEqual(parFrequence);
	});

	it('reste borne entre le plancher et le plafond', () => {
		for (let m = 0; m <= ECART_MAX; m++) {
			const b = bonusEcartExact(m, cfg);
			expect(b).toBeGreaterThanOrEqual(cfg.bonusPlancher);
			expect(b).toBeLessThanOrEqual(cfg.bonusPlafond);
		}
	});

	it('regroupe la queue au-dela du dernier seau', () => {
		// Un ecart de 45 n'est pas plus previsible qu'un de 30 : meme frequence,
		// donc meme bonus.
		expect(frequenceEcart(45)).toBe(frequenceEcart(ECART_MAX));
		expect(bonusEcartExact(45, cfg)).toBe(bonusEcartExact(ECART_MAX, cfg));
	});

	it('est calibre : le bonus moyen pondere vaut 100 %', () => {
		// La propriete qui justifie `k`. Le bareme redistribue les points entre
		// ecarts banals et ecarts rares, il n'en cree pas.
		let moyenne = 0;
		for (let m = 0; m <= ECART_MAX; m++) {
			moyenne += ECARTS.frequences[m] * bonusEcartExact(m, cfg);
		}
		expect(moyenne).toBeCloseTo(1, 4);
	});

	it('la table somme a 1 et compte tous les matchs analyses', () => {
		const somme = ECARTS.frequences.reduce((s, f) => s + f, 0);
		expect(somme).toBeCloseTo(1, 10);
		expect(ECARTS.effectifs.reduce((s, n) => s + n, 0)).toBe(ECARTS.matchs);
	});

	/**
	 * Consequence assumee de la formule : le bonus depend de l'ecart **annonce**,
	 * pas de l'ecart reel. Viser une valeur rare et la rater d'un point peut donc
	 * rapporter plus que toucher pile une valeur banale.
	 *
	 * Ce test ne juge pas la regle, il la fixe : si elle change un jour, c'est
	 * ici que ca se verra.
	 */
	it("peut payer davantage un ecart rare rate d'un point qu'un ecart banal exact", () => {
		const reel = 3;
		const exact = bonusEcart(3, reel, cfg); // pile sur l'ecart le plus courant
		const voisin = bonusEcart(2, reel, cfg); // rate d'un point, mais plus rare
		expect(voisin).toBeGreaterThan(exact);
	});
});

describe('ecart predit et enjeu', () => {
	it('derive un ecart signe de l’equipe et de l’ecart annonce', () => {
		expect(predictedDiff({ pickSide: 'home', marginPred: 7 })).toBe(7);
		expect(predictedDiff({ pickSide: 'away', marginPred: 7 })).toBe(-7);
		expect(predictedDiff({ pickSide: null, marginPred: 0 })).toBe(0);
	});

	it('prend la moyenne des baremes quand aucune equipe n\'est designee', () => {
		expect(stakePoints('home', GAME)).toBe(31);
		expect(stakePoints('away', GAME)).toBe(125);
		expect(stakePoints(null, GAME)).toBe(78);
	});

	it('lit une ligne de base sans inventer de valeurs', () => {
		expect(pickInputFromRow({ pickSide: 'away', marginPred: 3 })).toEqual({
			pickSide: 'away',
			marginPred: 3
		});

		// Ecart 0 : l'equipe est ignoree, un nul predit n'en designe aucune.
		expect(pickInputFromRow({ pickSide: 'home', marginPred: 0 })).toEqual({
			pickSide: null,
			marginPred: 0
		});

		// Ecart absent : on retombe sur 0 plutot que sur NaN.
		expect(pickInputFromRow({ pickSide: 'home', marginPred: null })).toEqual({
			pickSide: null,
			marginPred: 0
		});
	});
});

describe('playoffs', () => {
	const withPlayoffs: ScoringConfig = { ...cfg, playoffsEnabled: true };

	it('ignore les multiplicateurs quand l’option est desactivee', () => {
		expect(playoffMultiplier(3, 1, cfg)).toBe(1);
	});

	it('applique le multiplicateur du tour', () => {
		expect(playoffMultiplier(3, 1, withPlayoffs)).toBe(1.5);
		expect(playoffMultiplier(3, 2, withPlayoffs)).toBe(2);
		expect(playoffMultiplier(3, 3, withPlayoffs)).toBe(2.5);
		expect(playoffMultiplier(3, 5, withPlayoffs)).toBe(3);
	});

	it('laisse la saison reguliere a 1', () => {
		expect(playoffMultiplier(2, 7, withPlayoffs)).toBe(1);
	});

	it('multiplie les points du match', () => {
		// Annonce +12 sur un match qui finit +4 : aucun bonus, donc la base seule,
		// ce qui isole bien l'effet du multiplicateur.
		const r = computeScore(
			{ pickSide: 'home', marginPred: 12 },
			{ ...GAME, multiplier: 2 },
			{ scoreHome: 24, scoreAway: 20 },
			withPlayoffs
		);
		expect(r.points).toBe(62); // 31 x 1 x 2
	});
});

describe('coherence du pronostic', () => {
	it('tout ecart strictement positif designe une equipe', () => {
		expect(isPickConsistent({ pickSide: 'home', marginPred: 3 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'away', marginPred: 21 })).toBe(true);
		expect(isPickConsistent({ pickSide: null, marginPred: 6 })).toBe(false);
	});

	it('accepte les valeurs libres, refuse au-dela de la borne', () => {
		// La liste fermee de huit splits a disparu avec le bonus de rarete :
		// chaque valeur ayant son propre bareme, il n'y a plus a en interdire.
		expect(isPickConsistent({ pickSide: 'home', marginPred: 7 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'home', marginPred: 1 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'home', marginPred: 27 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'home', marginPred: MARGIN_MAX })).toBe(true);
		expect(isPickConsistent({ pickSide: 'home', marginPred: MARGIN_MAX + 1 })).toBe(false);
	});

	it('un ecart de 0 (nul predit) ne designe aucune equipe', () => {
		expect(isPickConsistent({ pickSide: null, marginPred: 0 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'home', marginPred: 0 })).toBe(false);
	});

	it('refuse un ecart negatif ou fractionnaire', () => {
		expect(isPickConsistent({ pickSide: 'home', marginPred: -3 })).toBe(false);
		expect(isPickConsistent({ pickSide: 'home', marginPred: 3.5 })).toBe(false);
	});
});

describe('idempotence du calcul', () => {
	it('deux appels identiques donnent le meme resultat', () => {
		const args = [
			{ pickSide: 'away' as const, marginPred: 4 },
			GAME,
			{ scoreHome: 20, scoreAway: 24 },
			cfg
		] as const;
		expect(computeScore(...args)).toEqual(computeScore(...args));
	});
});
