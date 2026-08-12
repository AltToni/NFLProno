import { describe, expect, it } from 'vitest';
import { SEASONTYPE_PLAYOFFS, SEASONTYPE_PRESEASON, SEASONTYPE_REGULAR, weekLabel, weekShortLabel } from './nfl';

describe('weekLabel', () => {
	it('numerote la saison reguliere', () => {
		expect(weekLabel(SEASONTYPE_REGULAR, 3)).toBe('Semaine 3');
		expect(weekShortLabel(SEASONTYPE_REGULAR, 3)).toBe('S3');
	});

	it('nomme les tours de playoffs', () => {
		expect(weekLabel(SEASONTYPE_PLAYOFFS, 1)).toBe('Wild Card');
		expect(weekShortLabel(SEASONTYPE_PLAYOFFS, 5)).toBe('SB');
	});

	/**
	 * Le point qui compte : ESPN decale la presaison d'un cran (sa semaine 1 est
	 * le Hall of Fame), et un libelle « Semaine 3 » de presaison serait
	 * indistinguable de la semaine 3 reguliere dans les onglets et l'historique
	 * du joueur.
	 */
	it('decale la presaison et ne dit jamais « Semaine n »', () => {
		expect(weekLabel(SEASONTYPE_PRESEASON, 1)).toBe('Presaison - Hall of Fame');
		expect(weekLabel(SEASONTYPE_PRESEASON, 2)).toBe('Presaison - semaine 1');
		expect(weekLabel(SEASONTYPE_PRESEASON, 4)).toBe('Presaison - semaine 3');

		expect(weekShortLabel(SEASONTYPE_PRESEASON, 1)).toBe('HOF');
		expect(weekShortLabel(SEASONTYPE_PRESEASON, 2)).toBe('Pre. S1');

		expect(weekLabel(SEASONTYPE_PRESEASON, 3)).not.toBe(weekLabel(SEASONTYPE_REGULAR, 3));
	});
});
