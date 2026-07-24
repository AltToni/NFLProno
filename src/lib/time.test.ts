import { describe, expect, it } from 'vitest';
import { depuis } from './time';

describe('depuis', () => {
	const T = 1_800_000_000;

	it('distingue jamais et a l’instant', () => {
		expect(depuis(null, T)).toBe('jamais');
		expect(depuis(T, T)).toBe("a l'instant");
		expect(depuis(T - 59, T)).toBe("a l'instant");
	});

	it('compte en minutes, heures puis jours', () => {
		expect(depuis(T - 60, T)).toBe('il y a 1 min');
		expect(depuis(T - 45 * 60, T)).toBe('il y a 45 min');
		expect(depuis(T - 3600, T)).toBe('il y a 1 h');
		expect(depuis(T - (3 * 3600 + 20 * 60), T)).toBe('il y a 3 h 20');
		expect(depuis(T - 86400, T)).toBe('il y a 1 jour');
		expect(depuis(T - 9 * 86400, T)).toBe('il y a 9 jours');
	});

	it('ne part pas dans le negatif si l’horloge a recule', () => {
		expect(depuis(T + 500, T)).toBe("a l'instant");
	});
});
