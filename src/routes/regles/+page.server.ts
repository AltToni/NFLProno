import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { getScoringConfig } from '$lib/server/settings';
import {
	basePoints,
	bonusEcart,
	bonusEcartExact,
	computeScore,
	ECART_MAX,
	ECARTS,
	frequenceEcart,
	predictedDiff,
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
	pick: PickInput;
	/** Pourquoi ce nombre de points — sans chiffre, il vient du calcul. */
	pourquoi: string;
}

/**
 * L'ordre n'est pas anodin : les deux premieres lignes ratent l'ecart du meme
 * point et ne rapportent pas la meme chose. C'est tout le bonus de rarete en
 * deux lignes.
 */
const LIGNES: Ligne[] = [
	{
		saisi: `${HOME_ABBR} +5`,
		pick: { pickSide: 'home', marginPred: 5 },
		pourquoi: 'rate d’un point, sur un ecart peu courant : le bonus reste eleve'
	},
	{
		saisi: `${HOME_ABBR} +3`,
		pick: { pickSide: 'home', marginPred: 3 },
		pourquoi: 'rate d’un point lui aussi, mais +3 est l’ecart le plus banal du jeu'
	},
	{
		saisi: `${HOME_ABBR} +4`,
		pick: { pickSide: 'home', marginPred: 4 },
		pourquoi: 'pile dessus : le bonus tombe plein'
	},
	{
		saisi: `${HOME_ABBR} +6`,
		pick: { pickSide: 'home', marginPred: 6 },
		pourquoi: 'rate de deux points : la moitie du bonus'
	},
	{
		saisi: `${HOME_ABBR} +12`,
		pick: { pickSide: 'home', marginPred: 12 },
		pourquoi: 'rate de huit : le bonus est eteint, les points de base restent'
	},
	{
		saisi: `${AWAY_ABBR} +3`,
		pick: { pickSide: 'away', marginPred: 3 },
		pourquoi: 'mauvais vainqueur'
	},
	{
		saisi: 'Match nul',
		pick: { pickSide: null, marginPred: 0 },
		pourquoi: 'le match a un vainqueur, et aucune equipe n’etait designee'
	}
];

/** Les deux memes pronostics, si le match avait fini sur un nul. */
const LIGNES_NUL: Ligne[] = [
	{
		saisi: 'Match nul',
		pick: { pickSide: null, marginPred: 0 },
		pourquoi: 'l’issue la plus rare du jeu, donc le bonus le plus eleve'
	},
	{
		saisi: `${HOME_ABBR} +3`,
		pick: { pickSide: 'home', marginPred: 3 },
		pourquoi: 'un nul reel n’est jamais un ecart « rate de peu »'
	}
];

/** « 1,375 » plutot que « 1.375 », et sans zeros inutiles. */
function nombre(valeur: number): string {
	return valeur.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
	const cfg = getScoringConfig();

	const jeu: GameBase = {
		basePointsHome: basePoints(P_HOME, cfg),
		basePointsAway: basePoints(P_AWAY, cfg)
	};

	/**
	 * Le facteur applique, recalcule depuis le bareme plutot que lu dans
	 * `points / enjeu` : les points sont arrondis a l'entier, et le quotient
	 * rendrait des facteurs qui ne sont la regle de personne.
	 */
	const facteurDe = (ligne: Ligne, resultat: GameOutcome, bonusKind: string): number => {
		if (bonusKind === 'draw') return cfg.drawFactor;
		return (
			1 +
			bonusEcart(
				Math.abs(predictedDiff(ligne.pick)),
				Math.abs(resultat.scoreHome - resultat.scoreAway),
				cfg
			)
		);
	};

	const calculer = (lignes: Ligne[], resultat: GameOutcome) =>
		lignes.map((ligne) => {
			const enjeu = stakePoints(ligne.pick.pickSide, jeu);
			const detail = computeScore(ligne.pick, jeu, resultat, cfg);
			const facteur = facteurDe(ligne, resultat, detail.bonusKind);
			return {
				saisi: ligne.saisi,
				pourquoi: ligne.pourquoi,
				points: detail.points,
				enjeu,
				// Un facteur de 1 n'apprend rien : la ligne n'affiche alors que ses
				// points, et le detail du calcul disparait.
				facteur: detail.points > 0 && facteur !== 1 ? nombre(facteur) : null
			};
		});

	/**
	 * La table de rarete, telle qu'elle est reellement appliquee. On montre les
	 * ecarts courants plutot que les trente-et-un seaux : c'est la comparaison
	 * qui parle, pas l'exhaustivite.
	 */
	const rarete = [0, 1, 3, 4, 6, 7, 10, 14, 17, 21, 28].map((m) => ({
		ecart: m,
		frequence: Math.round(frequenceEcart(m) * 1000) / 10,
		bonus: Math.round(bonusEcartExact(m, cfg) * 100)
	}));

	/** Perte de bonus point par point, jusqu'a extinction. */
	const tolerance = [0, 1, 2, 3, 4].map((erreur) => ({
		erreur,
		part: Math.round(Math.max(0, 1 - cfg.bonusPas * erreur) * 100)
	}));

	return {
		cfg: {
			k: cfg.k,
			baseMin: cfg.baseMin,
			baseMax: cfg.baseMax,
			playoffsEnabled: cfg.playoffsEnabled,
			playoffMultipliers: cfg.playoffMultipliers
		},
		facteurs: {
			nul: nombre(cfg.drawFactor),
			pas: Math.round(cfg.bonusPas * 100),
			plancher: Math.round(cfg.bonusPlancher * 100),
			plafond: Math.round(cfg.bonusPlafond * 100)
		},
		source: {
			depuis: ECARTS.depuis,
			jusqua: ECARTS.jusqua,
			matchs: ECARTS.matchs,
			ecartMax: ECART_MAX
		},
		rarete,
		tolerance,
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
