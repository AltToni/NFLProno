import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { getScoringConfig } from '$lib/server/settings';
import {
	basePoints,
	computeScore,
	SPLIT_CHOICES,
	stakePoints,
	type GameBase,
	type GameOutcome,
	type PickInput
} from '$lib/scoring';

/**
 * Page d'explication du bareme.
 *
 * L'exemple est **fige** — meme match, memes cotes, meme resultat a chaque
 * visite — mais ses points ne sont pas ecrits en dur : ils sortent de
 * `computeScore`, le moteur qui compte pour de vrai, avec la configuration
 * courante. Une constante modifiee dans /admin est donc repercutee ici, et la
 * page ne peut pas se mettre a mentir sur un bareme qui aurait bouge.
 */

/** Match d'illustration. Le meme que le README et les tests. */
const HOME_ABBR = 'KC';
const AWAY_ABBR = 'LV';

/**
 * Probabilites de victoire apres retrait de la marge du bookmaker. Choisies
 * rondes (80 / 20) pour que la division du bareme se suive de tete.
 */
const P_HOME = 0.8;
const P_AWAY = 0.2;

const RESULTAT: GameOutcome = { scoreHome: 24, scoreAway: 20 };
const RESULTAT_NUL: GameOutcome = { scoreHome: 20, scoreAway: 20 };

interface Ligne {
	/** Le pronostic tel que le joueur l'aurait saisi. */
	saisi: string;
	mode: 'A' | 'B';
	pick: PickInput;
	/** Pourquoi ce nombre de points — sans chiffre, il vient du calcul. */
	pourquoi: string;
}

const LIGNES: Ligne[] = [
	{
		saisi: `${HOME_ABBR} +3`,
		mode: 'A',
		pick: { mode: 'margin', pickSide: 'home', marginPred: 3 },
		pourquoi: 'bon vainqueur, split rate d’un point'
	},
	{
		saisi: `${HOME_ABBR} +6`,
		mode: 'A',
		pick: { mode: 'margin', pickSide: 'home', marginPred: 6 },
		pourquoi: 'bon vainqueur, split a deux points : rien de plus'
	},
	{
		saisi: `${AWAY_ABBR} +3`,
		mode: 'A',
		pick: { mode: 'margin', pickSide: 'away', marginPred: 3 },
		pourquoi: 'mauvais vainqueur'
	},
	{
		saisi: 'Match nul',
		mode: 'A',
		pick: { mode: 'margin', pickSide: null, marginPred: 0 },
		pourquoi: 'le match a un vainqueur, et aucune equipe n’etait designee'
	},
	{
		saisi: '20–24',
		mode: 'B',
		pick: { mode: 'score', pickSide: 'home', scoreHomePred: 24, scoreAwayPred: 20 },
		pourquoi: 'score exact'
	},
	{
		saisi: '23–27',
		mode: 'B',
		pick: { mode: 'score', pickSide: 'home', scoreHomePred: 27, scoreAwayPred: 23 },
		pourquoi: 'ecart exact, score rate'
	},
	{
		saisi: '22–25',
		mode: 'B',
		pick: { mode: 'score', pickSide: 'home', scoreHomePred: 25, scoreAwayPred: 22 },
		pourquoi: 'ecart de 3 contre 4 reel — le mode score n’a pas de bonus de proximite'
	},
	{
		saisi: '10–30',
		mode: 'B',
		pick: { mode: 'score', pickSide: 'home', scoreHomePred: 30, scoreAwayPred: 10 },
		pourquoi: 'bon vainqueur, rien de plus'
	}
];

/** Les deux memes pronostics, si le match avait fini sur un nul. */
const LIGNES_NUL: Ligne[] = [
	{
		saisi: 'Match nul',
		mode: 'A',
		pick: { mode: 'margin', pickSide: null, marginPred: 0 },
		pourquoi: 'nul predit, sur la moyenne des deux baremes'
	},
	{
		saisi: `${HOME_ABBR} +3`,
		mode: 'A',
		pick: { mode: 'margin', pickSide: 'home', marginPred: 3 },
		pourquoi: 'un nul reel n’est jamais un split « rate de peu »'
	}
];

/** « 1,375 » plutot que « 1.375 », et sans zeros inutiles. */
function nombre(valeur: number): string {
	return valeur
		.toFixed(3)
		.replace(/0+$/, '')
		.replace(/\.$/, '')
		.replace('.', ',');
}

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
	const cfg = getScoringConfig();

	const jeu: GameBase = {
		basePointsHome: basePoints(P_HOME, cfg),
		basePointsAway: basePoints(P_AWAY, cfg)
	};

	/**
	 * Le facteur applique, lu depuis le bareme via le bonus que le moteur a
	 * accorde.
	 *
	 * Surtout pas `points / enjeu` : les points sont arrondis a l'entier, et le
	 * quotient rendrait des facteurs qui ne sont la regle de personne — 43 / 31
	 * donne 1,387 la ou le bareme dit ×1,375. On affiche la regle, et les points
	 * a cote la verifient.
	 */
	const facteurDe = (bonus: string): number => {
		if (bonus === 'exact') return 1 + cfg.exactBonusPct;
		if (bonus === 'margin') return 1 + cfg.marginBonusPct;
		if (bonus === 'near') return 1 + cfg.marginBonusPct * cfg.nearMarginFactor;
		if (bonus === 'draw') return cfg.drawFactor;
		return 1;
	};

	const calculer = (lignes: Ligne[], resultat: GameOutcome) =>
		lignes.map((ligne) => {
			const enjeu = stakePoints(ligne.pick.pickSide, jeu);
			const detail = computeScore(ligne.pick, jeu, resultat, cfg);
			const facteur = facteurDe(detail.bonusKind);
			return {
				saisi: ligne.saisi,
				mode: ligne.mode,
				pourquoi: ligne.pourquoi,
				points: detail.points,
				enjeu,
				// Un facteur de 1 n'apprend rien : la ligne n'affiche alors que ses
				// points, et le detail du calcul disparait.
				facteur: detail.points > 0 && facteur !== 1 ? nombre(facteur) : null
			};
		});

	/**
	 * De quoi lire la regle de proximite d'un coup d'oeil : pour chaque ecart
	 * reel, le seul split qui rapporte quelque chose. Genere, donc toujours
	 * d'accord avec `SPLIT_CHOICES`.
	 */
	const proximite = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((reel) => {
		const exact = SPLIT_CHOICES.find((s) => s === reel) ?? null;
		const proche = SPLIT_CHOICES.find((s) => Math.abs(s - reel) === 1) ?? null;
		return { reel, exact, proche };
	});

	return {
		cfg: {
			k: cfg.k,
			baseMin: cfg.baseMin,
			baseMax: cfg.baseMax,
			playoffsEnabled: cfg.playoffsEnabled,
			playoffMultipliers: cfg.playoffMultipliers
		},
		facteurs: {
			ecartExact: nombre(1 + cfg.marginBonusPct),
			proximite: nombre(1 + cfg.marginBonusPct * cfg.nearMarginFactor),
			scoreExact: nombre(1 + cfg.exactBonusPct),
			nul: nombre(cfg.drawFactor),
			partProximite: nombre(cfg.nearMarginFactor)
		},
		splits: [...SPLIT_CHOICES],
		proximite,
		exemple: {
			homeAbbr: HOME_ABBR,
			awayAbbr: AWAY_ABBR,
			pHome: Math.round(P_HOME * 100),
			pAway: Math.round(P_AWAY * 100),
			basePointsHome: jeu.basePointsHome,
			basePointsAway: jeu.basePointsAway,
			enjeuNul: stakePoints(null, jeu),
			scoreHome: RESULTAT.scoreHome,
			scoreAway: RESULTAT.scoreAway,
			ecart: RESULTAT.scoreHome - RESULTAT.scoreAway,
			lignes: calculer(LIGNES, RESULTAT),
			nul: {
				scoreHome: RESULTAT_NUL.scoreHome,
				scoreAway: RESULTAT_NUL.scoreAway,
				lignes: calculer(LIGNES_NUL, RESULTAT_NUL)
			}
		}
	};
};
