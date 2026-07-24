import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SCORING,
	basePoints,
	computeScore,
	devig,
	impliedProbabilityRaw,
	isPickConsistent,
	playoffMultiplier,
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
	it('vainqueur correct sans bonus', () => {
		const r = computeScore(
			{ pickSide: 'home', scoreHomePred: 30, scoreAwayPred: 10 },
			GAME,
			{ scoreHome: 24, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(31);
		expect(r.bonusKind).toBe('none');
		expect(r.correct).toBe(true);
	});

	it('vainqueur incorrect : zero, jamais de negatif', () => {
		const r = computeScore(
			{ pickSide: 'away', scoreHomePred: 10, scoreAwayPred: 30 },
			GAME,
			{ scoreHome: 24, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(0);
		expect(r.correct).toBe(false);
	});

	it('ecart exact : +50 %', () => {
		const r = computeScore(
			{ pickSide: 'home', scoreHomePred: 27, scoreAwayPred: 23 },
			GAME,
			{ scoreHome: 24, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(Math.round(31 * 1.5));
		expect(r.bonusKind).toBe('margin');
		expect(r.exactMargin).toBe(true);
		expect(r.exactScore).toBe(false);
	});

	it('score exact : +100 %, non cumule avec l’ecart', () => {
		// Exemple de la spec : outsider a 125 pts, score exact -> 250 pts
		const r = computeScore(
			{ pickSide: 'away', scoreHomePred: 20, scoreAwayPred: 24 },
			GAME,
			{ scoreHome: 20, scoreAway: 24 },
			cfg
		);
		expect(r.points).toBe(250);
		expect(r.bonusKind).toBe('exact');
		expect(r.exactScore).toBe(true);
	});

	it('detail base + bonus coherent avec le total', () => {
		const r = computeScore(
			{ pickSide: 'away', scoreHomePred: 20, scoreAwayPred: 24 },
			GAME,
			{ scoreHome: 20, scoreAway: 24 },
			cfg
		);
		expect(r.basePoints + r.bonusPoints).toBe(r.points);
		expect(r.basePoints).toBe(125);
		expect(r.bonusPoints).toBe(125);
	});
});

describe('match nul', () => {
	it('donne 50 % des points de base de l’equipe choisie', () => {
		const r = computeScore(
			{ pickSide: 'away', scoreHomePred: 17, scoreAwayPred: 24 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(63); // round(125 * 0.5)
		expect(r.bonusKind).toBe('draw');
		expect(r.correct).toBe(false);
	});

	it('recompense le joueur qui avait predit un nul', () => {
		const r = computeScore(
			{ pickSide: 'away', scoreHomePred: 17, scoreAwayPred: 17 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(Math.round(125 * 1.5));
		expect(r.bonusKind).toBe('margin');
	});

	it('score de nul exact : bonus de score exact', () => {
		const r = computeScore(
			{ pickSide: 'home', scoreHomePred: 20, scoreAwayPred: 20 },
			GAME,
			{ scoreHome: 20, scoreAway: 20 },
			cfg
		);
		expect(r.points).toBe(62); // round(31 * 2)
		expect(r.bonusKind).toBe('exact');
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
		const r = computeScore(
			{ pickSide: 'home', scoreHomePred: 30, scoreAwayPred: 10 },
			{ ...GAME, multiplier: 2 },
			{ scoreHome: 24, scoreAway: 20 },
			withPlayoffs
		);
		expect(r.points).toBe(62);
	});
});

describe('coherence du pronostic', () => {
	it('accepte un score conforme au choix', () => {
		expect(isPickConsistent({ pickSide: 'home', scoreHomePred: 24, scoreAwayPred: 20 })).toBe(true);
		expect(isPickConsistent({ pickSide: 'away', scoreHomePred: 20, scoreAwayPred: 24 })).toBe(true);
	});

	it('accepte un nul quelle que soit l’equipe choisie', () => {
		expect(isPickConsistent({ pickSide: 'home', scoreHomePred: 20, scoreAwayPred: 20 })).toBe(true);
	});

	it('refuse un score qui contredit le choix', () => {
		expect(isPickConsistent({ pickSide: 'home', scoreHomePred: 17, scoreAwayPred: 24 })).toBe(false);
	});
});

describe('idempotence du calcul', () => {
	it('deux appels identiques donnent le meme resultat', () => {
		const args = [
			{ pickSide: 'away' as const, scoreHomePred: 20, scoreAwayPred: 24 },
			GAME,
			{ scoreHome: 20, scoreAway: 24 },
			cfg
		] as const;
		expect(computeScore(...args)).toEqual(computeScore(...args));
	});
});
