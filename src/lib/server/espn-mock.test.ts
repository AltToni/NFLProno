import { describe, expect, it } from 'vitest';
import {
	DUREE_MATCH_S,
	ECART_KICKOFF_S,
	FIXTURES,
	PREFIXE_ID,
	etatSimule,
	mockCreateGames,
	mockEnabled,
	mockPollGames
} from './espn-mock';
import { bonusEcartExact } from '$lib/scoring';

const BASE = 1_800_000_000;

describe('mockEnabled', () => {
	/**
	 * L'exigence la plus stricte du mode simulation : sans la variable, rien.
	 * Le test manipule process.env directement et le restaure, comme le ferait
	 * un demarrage sans MOCK_ESPN.
	 */
	it('exige MOCK_ESPN=1, exactement', () => {
		const avant = process.env.MOCK_ESPN;
		try {
			delete process.env.MOCK_ESPN;
			expect(mockEnabled()).toBe(false);
			process.env.MOCK_ESPN = '';
			expect(mockEnabled()).toBe(false);
			process.env.MOCK_ESPN = '0';
			expect(mockEnabled()).toBe(false);
			process.env.MOCK_ESPN = 'true';
			expect(mockEnabled()).toBe(false);
			process.env.MOCK_ESPN = '1';
			expect(mockEnabled()).toBe(true);
		} finally {
			if (avant === undefined) delete process.env.MOCK_ESPN;
			else process.env.MOCK_ESPN = avant;
		}
	});
});

describe('fixtures', () => {
	it('propose quatre matchs aux identifiants hors espace ESPN', () => {
		expect(FIXTURES).toHaveLength(4);
		for (const fixture of FIXTURES) {
			expect(fixture.id.startsWith(PREFIXE_ID)).toBe(true);
			// Un identifiant ESPN est numerique : celui-ci ne peut pas l'etre.
			expect(Number.isNaN(Number(fixture.id))).toBe(true);
			expect(fixture.quarts).toHaveLength(4);
		}
	});

	it("n'emprunte aucune abreviation d'equipe NFL", () => {
		const NFL = new Set([
			'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
			'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
			'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH'
		]);
		for (const fixture of FIXTURES) {
			expect(NFL.has(fixture.home.abbr)).toBe(false);
			expect(NFL.has(fixture.away.abbr)).toBe(false);
		}
	});

	it('couvre les branches du bareme : favori, surprise, nul, un point d\'ecart', () => {
		const ecarts = FIXTURES.map((f) => {
			const [h, a] = f.quarts[3];
			return h - a;
		});
		expect(ecarts).toContain(0); // match nul
		expect(ecarts.some((e) => e === 1 || e === -1)).toBe(true); // fin serree
		// L'ecart etant libre, la simulation n'a plus a viser une liste de splits.
		// Ce qu'elle doit encore montrer, c'est l'etendue du bonus de rarete : un
		// ecart banal qui rapporte peu, et un ecart rare qui rapporte beaucoup.
		const bonus = ecarts.filter((e) => e !== 0).map((e) => bonusEcartExact(Math.abs(e)));
		expect(Math.min(...bonus)).toBeLessThan(0.6);
		expect(Math.max(...bonus)).toBeGreaterThan(1);
		// Une surprise : l'equipe favorite (moneyline la plus negative) perd.
		const surprise = FIXTURES.some((f) => {
			const [h, a] = f.quarts[3];
			if (h === a) return false;
			const favoriEstHome = f.moneylineHome < f.moneylineAway;
			return favoriEstHome ? h < a : a < h;
		});
		expect(surprise).toBe(true);
	});
});

describe('mockCreateGames', () => {
	it('echelonne les kickoffs a +5, +10, +15 et +20 minutes', () => {
		const games = mockCreateGames(BASE);
		expect(games.map((g) => g.kickoffUtc - BASE)).toEqual([300, 600, 900, 1200]);
		expect(ECART_KICKOFF_S).toBe(300);
	});

	it('cree tout a venir, a 0-0, avec des cotes exploitables', () => {
		for (const game of mockCreateGames(BASE)) {
			expect(game.status).toBe('scheduled');
			expect(game.scoreHome).toBe(0);
			expect(game.scoreAway).toBe(0);
			expect(typeof game.odds?.moneylineHome).toBe('number');
			expect(typeof game.odds?.moneylineAway).toBe('number');
		}
	});
});

describe('etatSimule', () => {
	const fixture = FIXTURES[0];
	const kickoff = BASE + 300;

	it('reste a venir avant le kickoff', () => {
		expect(etatSimule(fixture, kickoff, kickoff - 1).status).toBe('scheduled');
	});

	it('passe en cours au kickoff, encore a 0-0 pendant le premier quart', () => {
		const etat = etatSimule(fixture, kickoff, kickoff);
		expect(etat.status).toBe('in');
		expect(etat.scoreHome).toBe(0);
		expect(etat.scoreAway).toBe(0);
		expect(etat.statusDetail).toContain('Q1');
	});

	it('fait progresser le score quart par quart', () => {
		const quart = DUREE_MATCH_S / 4;
		const observe = [0, 1, 2, 3].map((q) => {
			const etat = etatSimule(fixture, kickoff, kickoff + q * quart);
			return [etat.scoreHome, etat.scoreAway];
		});
		// Pendant Q1 on ne voit rien, puis le cumul du quart precedent.
		expect(observe).toEqual([[0, 0], fixture.quarts[0], fixture.quarts[1], fixture.quarts[2]]);
	});

	it('ne recule jamais et se termine sur le score final', () => {
		let precedent = 0;
		for (let t = 0; t <= DUREE_MATCH_S + 60; t += 15) {
			const etat = etatSimule(fixture, kickoff, kickoff + t);
			const total = etat.scoreHome + etat.scoreAway;
			expect(total).toBeGreaterThanOrEqual(precedent);
			precedent = total;
		}
		const fin = etatSimule(fixture, kickoff, kickoff + DUREE_MATCH_S);
		expect(fin.status).toBe('final');
		expect([fin.scoreHome, fin.scoreAway]).toEqual(fixture.quarts[3]);
	});

	it('reste final bien apres la fin', () => {
		const tard = etatSimule(fixture, kickoff, kickoff + 10 * DUREE_MATCH_S);
		expect(tard.status).toBe('final');
		expect([tard.scoreHome, tard.scoreAway]).toEqual(fixture.quarts[3]);
	});

	/** Aucun compteur persiste : deux appels au meme instant sont identiques. */
	it('est deterministe', () => {
		const t = kickoff + 333;
		expect(etatSimule(fixture, kickoff, t)).toEqual(etatSimule(fixture, kickoff, t));
	});
});

describe('mockPollGames', () => {
	it('rejoue depuis les kickoffs enregistres, sans les recalculer', () => {
		const crees = mockCreateGames(BASE);
		const stored = crees.map((g) => ({ id: g.id, kickoffUtc: g.kickoffUtc }));

		// 21 minutes plus tard : le premier match est fini, le dernier commence.
		const polled = mockPollGames(stored, BASE + 21 * 60);
		expect(polled.map((g) => g.kickoffUtc)).toEqual(crees.map((g) => g.kickoffUtc));
		expect(polled[0].status).toBe('final');
		expect(polled[3].status).toBe('in');
	});

	it('a tout en final trente minutes apres la creation', () => {
		const stored = mockCreateGames(BASE).map((g) => ({ id: g.id, kickoffUtc: g.kickoffUtc }));
		const polled = mockPollGames(stored, BASE + 30 * 60);
		expect(polled.every((g) => g.status === 'final')).toBe(true);
	});

	it('ignore un identifiant inconnu au lieu de faire echouer le poll', () => {
		const polled = mockPollGames([{ id: 'TEST-SIM-inconnu', kickoffUtc: BASE }], BASE);
		expect(polled).toEqual([]);
	});
});
