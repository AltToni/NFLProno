import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consommer, messageQuota, reinitialiser, viderTout, type Quota } from './ratelimit';

const QUOTA: Quota = { max: 3, fenetreSecondes: 60 };

describe('consommer', () => {
	beforeEach(() => {
		viderTout();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('laisse passer jusqu’au quota puis refuse', () => {
		expect(consommer('a', QUOTA).autorise).toBe(true);
		expect(consommer('a', QUOTA).autorise).toBe(true);
		const troisieme = consommer('a', QUOTA);
		expect(troisieme.autorise).toBe(true);
		expect(troisieme.restant).toBe(0);
		expect(consommer('a', QUOTA).autorise).toBe(false);
	});

	it('compte separement chaque cle', () => {
		for (let i = 0; i < 3; i++) consommer('a', QUOTA);
		expect(consommer('a', QUOTA).autorise).toBe(false);
		expect(consommer('b', QUOTA).autorise).toBe(true);
	});

	/**
	 * Le point de la fenetre glissante : avec un compteur remis a zero, on
	 * pourrait faire `max` tentatives juste avant la bascule et `max` juste
	 * apres, soit le double en quelques secondes.
	 */
	it('ne se vide pas d’un coup a la fin de la fenetre', () => {
		consommer('a', QUOTA);
		vi.advanceTimersByTime(50_000);
		consommer('a', QUOTA);
		consommer('a', QUOTA);
		expect(consommer('a', QUOTA).autorise).toBe(false);

		// La premiere tentative sort de la fenetre : une place se libere, une seule.
		vi.advanceTimersByTime(11_000);
		expect(consommer('a', QUOTA).autorise).toBe(true);
		expect(consommer('a', QUOTA).autorise).toBe(false);
	});

	it('annonce une attente coherente', () => {
		for (let i = 0; i < 3; i++) consommer('a', QUOTA);
		const refus = consommer('a', QUOTA);
		expect(refus.attendre).toBeGreaterThan(0);
		expect(refus.attendre).toBeLessThanOrEqual(60);
	});

	it('reinitialiser rend le quota', () => {
		for (let i = 0; i < 3; i++) consommer('a', QUOTA);
		expect(consommer('a', QUOTA).autorise).toBe(false);
		reinitialiser('a');
		expect(consommer('a', QUOTA).autorise).toBe(true);
	});
});

describe('messageQuota', () => {
	it('arrondit a la minute superieure', () => {
		expect(messageQuota({ autorise: false, restant: 0, attendre: 30 })).toContain('une minute');
		expect(messageQuota({ autorise: false, restant: 0, attendre: 61 })).toContain('2 minutes');
	});

	it('ne laisse pas deviner quel quota a ete atteint', () => {
		const a = messageQuota({ autorise: false, restant: 0, attendre: 120 });
		const b = messageQuota({ autorise: false, restant: 0, attendre: 120 });
		expect(a).toBe(b);
		expect(a).not.toMatch(/email|ip|adresse/i);
	});
});
