import type { EspnGame, EspnTeam } from './espn';

/**
 * Client ESPN factice : quatre matchs fictifs qui se deroulent en une demi-heure
 * au lieu d'un week-end. Il sert a valider en conditions accelerees ce qu'une
 * vraie saison ne montre que quelques minutes par semaine :
 *
 *  - le verrouillage exact au kickoff,
 *  - l'apparition des pronostics des autres joueurs une fois le match commence,
 *  - le calcul des points au passage en `final`.
 *
 * **Jamais actif si MOCK_ESPN est absent** : `mockEnabled()` garde la creation
 * d'une semaine de simulation comme son rafraichissement. Aucun appel reseau,
 * aucune equipe reelle, aucun identifiant ESPN reel.
 */

/** MOCK_ESPN=1, et rien d'autre : une variable presente mais vide reste inactive. */
export function mockEnabled(): boolean {
	return process.env.MOCK_ESPN === '1';
}

/** Ecart entre deux kickoffs : matchs a +5, +10, +15 et +20 minutes. */
export const ECART_KICKOFF_S = 5 * 60;

/**
 * Duree d'un match simule. Dix minutes : assez long pour observer plusieurs
 * polls (le score change tous les quarts, soit toutes les 2 min 30), assez
 * court pour que les quatre matchs soient finals trente minutes apres la
 * creation de la semaine.
 */
export const DUREE_MATCH_S = 10 * 60;

interface FixtureTeam {
	abbr: string;
	name: string;
}

export interface Fixture {
	id: string;
	home: FixtureTeam;
	away: FixtureTeam;
	moneylineHome: number;
	moneylineAway: number;
	/** Score cumule a la fin de chaque quart-temps. Le dernier est le score final. */
	quarts: [number, number][];
}

/**
 * Equipes volontairement imaginaires et belges : aucune abreviation NFL
 * existante, donc une fixture ne peut jamais etre confondue avec un vrai match
 * dans une capture d'ecran ou un export de base.
 *
 * Les quatre cas couvrent les branches du bareme : favori qui confirme,
 * surprise, match nul, et fin serree ou l'ecart exact se joue a un point.
 */
export const FIXTURES: Fixture[] = [
	{
		id: 'TEST-SIM-1',
		home: { abbr: 'ARD', name: "Aurochs d'Ardenne" },
		away: { abbr: 'BRB', name: 'Bisons du Brabant' },
		// Gros favori : ~80 % implicite, donc peu de points a la cle. Ecart final
		// de 15 points : un ecart rare, qui exerce le haut de la table de rarete.
		moneylineHome: -400,
		moneylineAway: 300,
		quarts: [
			[7, 0],
			[14, 3],
			[20, 13],
			[28, 13]
		]
	},
	{
		id: 'TEST-SIM-2',
		home: { abbr: 'CON', name: 'Corbeaux du Condroz' },
		away: { abbr: 'FAG', name: 'Faucons de Gaume' },
		// La surprise : le favori mene jusqu'au dernier quart et perd. Ecart final
		// de 7 points : a un point d'un ecart courant, exerce l'attenuation.
		moneylineHome: -200,
		moneylineAway: 170,
		quarts: [
			[7, 3],
			[10, 10],
			[17, 17],
			[17, 24]
		]
	},
	{
		id: 'TEST-SIM-3',
		home: { abbr: 'HSB', name: 'Hiboux de Semois' },
		away: { abbr: 'LOU', name: 'Loups de Lorraine' },
		// Match nul : exerce `drawFactor` et le pronostic de nul.
		moneylineHome: 105,
		moneylineAway: -125,
		quarts: [
			[0, 7],
			[10, 7],
			[13, 17],
			[20, 20]
		]
	},
	{
		id: 'TEST-SIM-4',
		home: { abbr: 'MOS', name: "Mouettes d'Ostende" },
		away: { abbr: 'RCH', name: 'Renards de Chimay' },
		// Un point d'ecart : le bonus d'ecart exact se gagne ou se rate de peu.
		moneylineHome: 120,
		moneylineAway: -140,
		quarts: [
			[7, 7],
			[7, 13],
			[14, 20],
			[21, 20]
		]
	}
];

const PAR_ID = new Map(FIXTURES.map((f) => [f.id, f]));

/** Les identifiants ESPN sont numeriques : ce prefixe ne peut pas entrer en collision. */
export const PREFIXE_ID = 'TEST-SIM-';

function team(t: FixtureTeam): EspnTeam {
	return { id: null, abbreviation: t.abbr, displayName: t.name, logo: null };
}

export interface EtatSimule {
	status: EspnGame['status'];
	statusDetail: string;
	scoreHome: number;
	scoreAway: number;
}

/**
 * Etat d'un match a un instant donne, deduit uniquement de `nowTs` et du
 * kickoff — aucun compteur persiste. Deux consequences voulues : le mock
 * survit a un redemarrage du conteneur, et deux polls rapproches renvoient la
 * meme chose plutot qu'une progression artificielle.
 *
 * Cinq etats observables par match : 0-0 pendant le premier quart, puis le
 * score cumule a la fin de Q1, Q2, Q3, puis le score final.
 */
export function etatSimule(fixture: Fixture, kickoffUtc: number, nowTs: number): EtatSimule {
	const ecoule = nowTs - kickoffUtc;

	if (ecoule < 0) {
		return { status: 'scheduled', statusDetail: 'Simulation - a venir', scoreHome: 0, scoreAway: 0 };
	}

	if (ecoule >= DUREE_MATCH_S) {
		const [h, a] = fixture.quarts[3];
		return { status: 'final', statusDetail: 'Simulation - Final', scoreHome: h, scoreAway: a };
	}

	// 0 pendant Q1, 1 pendant Q2... : on affiche le cumul du quart *acheve*.
	const quartEnCours = Math.min(3, Math.floor((ecoule / DUREE_MATCH_S) * 4));
	const [h, a] = quartEnCours === 0 ? [0, 0] : fixture.quarts[quartEnCours - 1];

	return {
		status: 'in',
		statusDetail: `Simulation - Q${quartEnCours + 1}`,
		scoreHome: h,
		scoreAway: a
	};
}

function construire(fixture: Fixture, kickoffUtc: number, nowTs: number): EspnGame {
	const etat = etatSimule(fixture, kickoffUtc, nowTs);
	return {
		id: fixture.id,
		kickoffUtc,
		status: etat.status,
		statusDetail: etat.statusDetail,
		home: team(fixture.home),
		away: team(fixture.away),
		scoreHome: etat.scoreHome,
		scoreAway: etat.scoreAway,
		odds: {
			provider: 'Simulation',
			moneylineHome: fixture.moneylineHome,
			moneylineAway: fixture.moneylineAway,
			spread: null,
			overUnder: null,
			raw: { simulation: true }
		}
	};
}

/**
 * Les quatre matchs a la creation de la semaine : kickoffs a +5, +10, +15 et
 * +20 minutes, tous encore `scheduled`. C'est le seul moment ou les kickoffs
 * sont calcules ; ensuite ils viennent de la base.
 */
export function mockCreateGames(baseTs: number): EspnGame[] {
	return FIXTURES.map((fixture, index) =>
		construire(fixture, baseTs + (index + 1) * ECART_KICKOFF_S, baseTs)
	);
}

/**
 * Rafraichissement : on repart des kickoffs deja enregistres, donc la
 * chronologie reste celle fixee a la creation meme si le poll a du retard.
 * Un identifiant inconnu (fixture retiree du code) est ignore plutot que de
 * faire echouer tout le poll.
 */
export function mockPollGames(
	stored: { id: string; kickoffUtc: number }[],
	nowTs: number
): EspnGame[] {
	const sorties: EspnGame[] = [];
	for (const row of stored) {
		const fixture = PAR_ID.get(row.id);
		if (fixture) sorties.push(construire(fixture, row.kickoffUtc, nowTs));
	}
	return sorties;
}
