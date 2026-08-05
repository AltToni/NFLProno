/**
 * Analyse historique des ecarts de score en saison reguliere NFL.
 *
 * Sert une seule fois : il produit la table de frequences `f(m)` qui pondere
 * le bonus d'ecart, puis celle-ci est **figee** dans le depot. Le bareme ne
 * doit pas bouger sous les joueurs en cours de saison, et une table recalculee
 * chaque semaine ferait exactement cela.
 *
 *   npx vite-node scripts/analyse-ecarts.ts -- [--depuis 2015] [--jusqu-a 2025]
 *
 * Les reponses ESPN sont mises en cache sur disque (`.cache/espn/`) : le script
 * fait ~190 requetes, et une seconde execution ne doit rien redemander.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getScoreboard, parseScoreboard } from '../src/lib/server/espn';

const RACINE = resolve(import.meta.dirname, '..');
const CACHE = join(RACINE, '.cache', 'espn');
const SORTIE_JSON = join(RACINE, 'src', 'lib', 'ecarts-nfl.json');
const SORTIE_RAPPORT = join(RACINE, 'scripts', 'analyse-ecarts.md');

/** Au-dela, la queue est trop fine pour porter une frequence propre. */
const ECART_MAX = 30;

const SEASONTYPE_REGULIERE = 2;

/** La saison reguliere est passee de 17 a 18 semaines en 2021. */
function nbSemaines(saison: number): number {
	return saison >= 2021 ? 18 : 17;
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------

interface Match {
	saison: number;
	semaine: number;
	id: string;
	ecart: number;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Une semaine de calendrier, depuis le cache disque ou depuis ESPN.
 *
 * Le client a deja ses propres reessais, mais sur ~190 requetes d'affilee
 * l'API renvoie regulierement des 502 qui durent plus longtemps que son
 * backoff. Une seconde couche, plus patiente, evite de perdre toute la
 * collecte pour une minute d'indisponibilite.
 */
async function scoreboardCache(saison: number, semaine: number) {
	const fichier = join(CACHE, `${saison}-${SEASONTYPE_REGULIERE}-${semaine}.json`);
	if (existsSync(fichier)) {
		return parseScoreboard(JSON.parse(readFileSync(fichier, 'utf8')));
	}

	let derniere: Error | null = null;
	for (let essai = 1; essai <= 5; essai++) {
		try {
			const { parsed, raw } = await getScoreboard(saison, SEASONTYPE_REGULIERE, semaine);
			mkdirSync(dirname(fichier), { recursive: true });
			writeFileSync(fichier, JSON.stringify(raw));
			// Le cache rend les reprises gratuites ; ce delai garde le rythme
			// raisonnable pour une API publique et sans cle.
			await pause(250);
			return parsed;
		} catch (err) {
			derniere = err as Error;
			if (essai < 5) {
				const attente = 3000 * essai;
				process.stderr.write(
					`    ${saison} S${semaine} : ${derniere.message.slice(0, 60)}… reprise dans ${attente / 1000} s\n`
				);
				await pause(attente);
			}
		}
	}
	throw derniere;
}

async function collecter(depuis: number, jusqua: number): Promise<Match[]> {
	const matchs: Match[] = [];
	const ignores: string[] = [];
	/**
	 * Une semaine manquante biaiserait la table sans le dire. La collecte va
	 * jusqu'au bout pour connaitre l'ampleur du trou, puis `main` refuse
	 * d'ecrire : mieux vaut relancer — le cache rend la reprise quasi
	 * gratuite — que figer un bareme sur des donnees incompletes.
	 */
	const manquantes: string[] = [];

	for (let saison = depuis; saison <= jusqua; saison++) {
		let recoltes = 0;
		for (let semaine = 1; semaine <= nbSemaines(saison); semaine++) {
			let board;
			try {
				board = await scoreboardCache(saison, semaine);
			} catch (err) {
				manquantes.push(`${saison} S${semaine} (${(err as Error).message.slice(0, 50)})`);
				continue;
			}
			for (const game of board.games) {
				// Seuls les matchs joues jusqu'au bout portent un ecart. Les
				// reports et annulations (2020 en a eu) n'ont pas de score.
				if (game.status !== 'final' || game.scoreHome === null || game.scoreAway === null) {
					ignores.push(`${saison} S${semaine} ${game.away.abbr}@${game.home.abbr} (${game.status})`);
					continue;
				}
				matchs.push({
					saison,
					semaine,
					id: game.id,
					ecart: Math.abs(game.scoreHome - game.scoreAway)
				});
				recoltes++;
			}
		}
		process.stderr.write(`  ${saison} : ${recoltes} matchs\n`);
	}

	if (ignores.length > 0) {
		process.stderr.write(`  ${ignores.length} match(s) sans score final, ignores\n`);
	}
	if (manquantes.length > 0) {
		throw new Error(
			`${manquantes.length} semaine(s) n'ont pas pu etre recuperees :\n    ` +
				manquantes.join('\n    ') +
				`\n  Relance le script : les semaines deja recuperees sont en cache.`
		);
	}
	return matchs;
}

// ---------------------------------------------------------------------------
// Frequences
// ---------------------------------------------------------------------------

export interface TableEcarts {
	/** Saisons couvertes, bornes incluses. */
	depuis: number;
	jusqua: number;
	matchs: number;
	/** Dernier seau, qui regroupe tous les ecarts superieurs ou egaux. */
	ecartMax: number;
	/** f(m) pour m de 0 a `ecartMax`, index = m. Somme = 1. */
	frequences: number[];
	/** Effectifs bruts, meme indexation. Conserves pour l'audit. */
	effectifs: number[];
}

function frequences(matchs: Match[], depuis: number, jusqua: number): TableEcarts {
	const effectifs = new Array<number>(ECART_MAX + 1).fill(0);
	for (const m of matchs) {
		// Tout ce qui depasse tombe dans le dernier seau : « 30 » veut donc dire
		// « 30 ou plus », et la somme des frequences reste exactement 1.
		effectifs[Math.min(m.ecart, ECART_MAX)]++;
	}
	const total = matchs.length;
	return {
		depuis,
		jusqua,
		matchs: total,
		ecartMax: ECART_MAX,
		frequences: effectifs.map((n) => n / total),
		effectifs
	};
}

// ---------------------------------------------------------------------------
// Calibration de k
// ---------------------------------------------------------------------------

const PLANCHER = 0.25;
const PLAFOND = 2;

export function bonusExact(f: number, k: number, plancher = PLANCHER, plafond = PLAFOND): number {
	if (!(f > 0)) return plafond;
	return Math.min(plafond, Math.max(plancher, k / f));
}

/**
 * Moyenne du bonus, ponderee par la frequence des ecarts, sur l'ensemble des
 * ecarts jouables.
 *
 * `poids` est renormalise : si tous les ecarts ne sont pas jouables, la moyenne
 * doit porter sur ceux qui le sont, sans quoi elle serait tiree vers le bas par
 * des valeurs que personne ne peut choisir.
 */
export function moyennePonderee(
	table: TableEcarts,
	k: number,
	jouables: number[]
): number {
	const masse = jouables.reduce((s, m) => s + table.frequences[m], 0);
	if (!(masse > 0)) return 0;
	return jouables.reduce((s, m) => s + (table.frequences[m] / masse) * bonusExact(table.frequences[m], k), 0);
}

/**
 * `k` tel que la moyenne ponderee vaille 1 (soit +100 % de bonus moyen).
 *
 * La moyenne croit avec k et sature entre plancher et plafond : une bissection
 * suffit, et elle est stable meme quand une partie des ecarts est deja au
 * plafond.
 */
export function calibrer(table: TableEcarts, jouables: number[], cible = 1): number {
	let bas = 0;
	let haut = 1;
	while (moyennePonderee(table, haut, jouables) < cible && haut < 1e6) haut *= 2;

	for (let i = 0; i < 200; i++) {
		const milieu = (bas + haut) / 2;
		if (moyennePonderee(table, milieu, jouables) < cible) bas = milieu;
		else haut = milieu;
	}
	return (bas + haut) / 2;
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

const pct = (x: number) => `${(x * 100).toFixed(2)} %`;

function rapport(table: TableEcarts, k: number, jouables: number[]): string {
	const l: string[] = [];
	l.push(`# Ecarts de score en saison reguliere NFL\n`);
	l.push(
		`Genere par \`scripts/analyse-ecarts.ts\` sur les saisons **${table.depuis}-${table.jusqua}**, ` +
			`soit **${table.matchs} matchs** joues jusqu'au bout.\n`
	);
	l.push(
		`Le seau \`${table.ecartMax}\` regroupe tous les ecarts de ${table.ecartMax} points ou plus : ` +
			`pris un par un, ils sont trop rares pour porter une frequence stable.\n`
	);
	l.push(`\n## Constante de calibration\n`);
	l.push(
		`\`k = ${k.toFixed(6)}\`, choisi pour que le bonus moyen — pondere par la frequence ` +
			`reelle des ecarts — vaille **${pct(moyennePonderee(table, k, jouables))}**.\n`
	);
	l.push(
		`Bonus d'un ecart exact : \`clamp(k / f(m), ${pct(PLANCHER)}, ${pct(PLAFOND)})\`. ` +
			`Plus l'ecart vise est improbable, plus il rapporte.\n`
	);

	l.push(`\n## Table\n`);
	l.push(`| Ecart | Matchs | f(m) | Bonus si exact |`);
	l.push(`|---|---:|---:|---:|`);
	for (let m = 0; m <= table.ecartMax; m++) {
		const f = table.frequences[m];
		const libelle = m === table.ecartMax ? `${m}+` : m === 0 ? '0 (nul)' : String(m);
		const bonus = jouables.includes(m) ? `+${(bonusExact(f, k) * 100).toFixed(0)} %` : '—';
		l.push(`| ${libelle} | ${table.effectifs[m]} | ${pct(f)} | ${bonus} |`);
	}

	l.push(`\n## Lecture\n`);
	const tri = [...Array(table.ecartMax + 1).keys()]
		.filter((m) => jouables.includes(m))
		.sort((a, b) => table.frequences[b] - table.frequences[a]);
	l.push(
		`- L'ecart le plus courant est **${tri[0]}** (${pct(table.frequences[tri[0]])} des matchs), ` +
			`qui rapporte le bonus le plus faible : **+${(bonusExact(table.frequences[tri[0]], k) * 100).toFixed(0)} %**.`
	);
	const rare = tri[tri.length - 1];
	l.push(
		`- Le plus rare des ecarts jouables est **${rare}** (${pct(table.frequences[rare])}), ` +
			`a **+${(bonusExact(table.frequences[rare], k) * 100).toFixed(0)} %**.`
	);
	const auPlafond = tri.filter((m) => bonusExact(table.frequences[m], k) >= PLAFOND);
	l.push(
		`- ${auPlafond.length} ecart(s) atteignent le plafond de ${pct(PLAFOND)} : ` +
			(auPlafond.length ? `${auPlafond.sort((a, b) => a - b).join(', ')}.` : 'aucun.')
	);
	return l.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

async function main() {
	const args = process.argv.slice(2);
	const lire = (nom: string, defaut: number) => {
		const i = args.indexOf(nom);
		return i >= 0 && args[i + 1] ? Number(args[i + 1]) : defaut;
	};
	const depuis = lire('--depuis', 2015);
	const jusqua = lire('--jusqu-a', 2025);

	process.stderr.write(`Collecte ${depuis}-${jusqua} (saison reguliere)\n`);
	const matchs = await collecter(depuis, jusqua);
	const table = frequences(matchs, depuis, jusqua);

	// Tous les ecarts sont jouables : la saisie accepte n'importe quel entier.
	const jouables = [...Array(table.ecartMax + 1).keys()];
	const k = calibrer(table, jouables);

	mkdirSync(dirname(SORTIE_JSON), { recursive: true });
	writeFileSync(
		SORTIE_JSON,
		JSON.stringify({ ...table, k, plancher: PLANCHER, plafond: PLAFOND }, null, '\t') + '\n'
	);
	writeFileSync(SORTIE_RAPPORT, rapport(table, k, jouables));

	process.stderr.write(`\n${table.matchs} matchs, k = ${k.toFixed(6)}\n`);
	process.stderr.write(`Ecrit : ${SORTIE_JSON}\n`);
	process.stderr.write(`Ecrit : ${SORTIE_RAPPORT}\n`);
}

main().catch((err) => {
	process.stderr.write(`ECHEC : ${err.message}\n`);
	process.exit(1);
});
