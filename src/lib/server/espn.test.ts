import { describe, expect, it } from 'vitest';
import { extractOdds, parseAmerican, parseScoreboard, scoreboardUrl } from './espn';

describe('scoreboardUrl', () => {
	/**
	 * Regression : `year=2026&week=1&seasontype=2` renvoyait la semaine 1 de 2025.
	 * Seul `dates` selectionne reellement la saison chez ESPN.
	 */
	it('porte la saison sur dates, pas seulement sur year', () => {
		const url = scoreboardUrl(2026, 2, 1);
		expect(url).toContain('dates=2026');
		expect(url).toContain('week=1');
		expect(url).toContain('seasontype=2');
	});
});

describe('parseAmerican', () => {
	it('accepte nombres et chaines', () => {
		expect(parseAmerican(-160)).toBe(-160);
		expect(parseAmerican('-160')).toBe(-160);
		expect(parseAmerican('+120')).toBe(120);
		expect(parseAmerican(' 120 ')).toBe(120);
	});

	it('traite EVEN comme +100', () => {
		expect(parseAmerican('EVEN')).toBe(100);
	});

	it('rejette les valeurs inexploitables', () => {
		expect(parseAmerican(null)).toBeNull();
		expect(parseAmerican('')).toBeNull();
		expect(parseAmerican(0)).toBeNull();
		expect(parseAmerican('n/a')).toBeNull();
	});
});

describe('extractOdds', () => {
	it('prefere ESPN BET aux autres bookmakers', () => {
		const odds = extractOdds([
			{
				provider: { id: '99', name: 'Autre Book' },
				homeTeamOdds: { moneyLine: -110 },
				awayTeamOdds: { moneyLine: -110 }
			},
			{
				provider: { id: '58', name: 'ESPN BET' },
				spread: -3.5,
				overUnder: 44.5,
				homeTeamOdds: { moneyLine: -180 },
				awayTeamOdds: { moneyLine: 150 }
			}
		]);
		expect(odds?.provider).toBe('ESPN BET');
		expect(odds?.moneylineHome).toBe(-180);
		expect(odds?.moneylineAway).toBe(150);
		expect(odds?.spread).toBe(-3.5);
	});

	it('lit le format imbrique de la core API', () => {
		const odds = extractOdds([
			{
				provider: { id: '58', name: 'ESPN BET' },
				homeTeamOdds: { current: { moneyLine: { american: '-425' } } },
				awayTeamOdds: { current: { moneyLine: { american: '+330' } } }
			}
		]);
		expect(odds?.moneylineHome).toBe(-425);
		expect(odds?.moneylineAway).toBe(330);
	});

	it('renvoie null sur un tableau vide', () => {
		expect(extractOdds([])).toBeNull();
		expect(extractOdds(undefined)).toBeNull();
	});

	it('conserve spread et total meme sans moneyline exploitable', () => {
		const odds = extractOdds([{ provider: { name: 'X' }, spread: -6.5, overUnder: 41 }]);
		expect(odds?.moneylineHome).toBeNull();
		expect(odds?.spread).toBe(-6.5);
	});
});

const SCOREBOARD = {
	season: { year: 2026, type: 2 },
	week: { number: 1 },
	events: [
		{
			id: '401700000',
			competitions: [
				{
					date: '2026-09-10T00:20Z',
					status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', detail: 'Thu, 10 Sept' } },
					odds: [
						{
							provider: { id: '58', name: 'ESPN BET' },
							homeTeamOdds: { moneyLine: -250 },
							awayTeamOdds: { moneyLine: 200 }
						}
					],
					competitors: [
						{
							homeAway: 'home',
							score: '0',
							team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs', logo: 'kc.png' }
						},
						{
							homeAway: 'away',
							score: '0',
							team: { id: '13', abbreviation: 'LV', displayName: 'Las Vegas Raiders', logo: 'lv.png' }
						}
					]
				}
			]
		},
		{
			id: '401700001',
			competitions: [
				{
					date: '2026-09-13T17:00Z',
					status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true, detail: 'Final' } },
					competitors: [
						{ homeAway: 'home', score: '24', team: { abbreviation: 'PHI', displayName: 'Eagles' } },
						{ homeAway: 'away', score: '20', team: { abbreviation: 'DAL', displayName: 'Cowboys' } }
					]
				}
			]
		},
		{
			id: '401700002',
			competitions: [
				{
					date: '2026-09-13T17:00Z',
					status: { type: { name: 'STATUS_POSTPONED', state: 'pre' } },
					competitors: [
						{ homeAway: 'home', score: '0', team: { abbreviation: 'BUF', displayName: 'Bills' } },
						{ homeAway: 'away', score: '0', team: { abbreviation: 'NYJ', displayName: 'Jets' } }
					]
				}
			]
		}
	]
};

describe('parseScoreboard', () => {
	it('extrait la periode', () => {
		const parsed = parseScoreboard(SCOREBOARD);
		expect(parsed.season).toBe(2026);
		expect(parsed.seasontype).toBe(2);
		expect(parsed.week).toBe(1);
		expect(parsed.games).toHaveLength(3);
	});

	it('lit equipes, kickoff et cotes', () => {
		const game = parseScoreboard(SCOREBOARD).games[0];
		expect(game.home.abbreviation).toBe('KC');
		expect(game.away.abbreviation).toBe('LV');
		expect(game.status).toBe('scheduled');
		expect(game.odds?.moneylineHome).toBe(-250);
		expect(game.kickoffUtc).toBe(Math.floor(Date.parse('2026-09-10T00:20Z') / 1000));
	});

	it('reconnait un match termine sans cotes', () => {
		const game = parseScoreboard(SCOREBOARD).games[1];
		expect(game.status).toBe('final');
		expect(game.scoreHome).toBe(24);
		expect(game.scoreAway).toBe(20);
		expect(game.odds).toBeNull();
	});

	it('reconnait un match reporte', () => {
		expect(parseScoreboard(SCOREBOARD).games[2].status).toBe('postponed');
	});

	it('tolere une charge utile vide ou cassee', () => {
		expect(parseScoreboard({}).games).toEqual([]);
		expect(parseScoreboard({ events: [{ id: '1' }] }).games).toEqual([]);
		expect(parseScoreboard({ events: [{ id: '1', competitions: [{ competitors: [] }] }] }).games).toEqual(
			[]
		);
	});
});
