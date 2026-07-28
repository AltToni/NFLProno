import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db, sqlite } from './db';
import { cronRuns, games, oddsSnapshots, weeks } from './db/schema';
import { TASK_LABELS, type TaskName } from './cron';
import { now } from '$lib/time';

/**
 * Etat operationnel du systeme : ce qu'il faut regarder le mercredi matin.
 *
 * Deux principes :
 *
 *  1. La vivacite (« le process repond, la base s'ouvre ») et la fraicheur
 *     (« le dernier snapshot date d'une semaine ») sont deux choses
 *     differentes. Seule la premiere pilote le healthcheck Docker : un
 *     conteneur redemarre en boucle parce qu'on est en intersaison serait
 *     absurde.
 *  2. Les seuils sont contextuels. Hors saison, l'absence de snapshot et de
 *     poll de scores est normale — la signaler noierait le signal utile.
 */

const HEURE = 3600;
const JOUR = 24 * HEURE;

/** Age au-dela duquel une sauvegarde n'est plus rassurante (elle est quotidienne). */
const SEUIL_SAUVEGARDE = 2 * JOUR;
/** Le snapshot est hebdomadaire : au-dela de 8 jours en saison, il a saute. */
const SEUIL_SNAPSHOT = 8 * JOUR;
/** Le poll tourne toutes les 15 min pendant la fenetre de matchs. */
const SEUIL_POLL = 6 * HEURE;

export type Gravite = 'ok' | 'attention' | 'probleme';

export interface Indicateur {
	cle: string;
	libelle: string;
	gravite: Gravite;
	/** Horodatage unix de l'evenement, ou null s'il n'a jamais eu lieu. */
	horodatage: number | null;
	detail: string;
}

export interface EtatSysteme {
	/** Vivacite seule : c'est ce que suit le healthcheck. */
	vivant: boolean;
	/** Synthese de fraicheur, sans effet sur le code HTTP. */
	gravite: Gravite;
	enSaison: boolean;
	horodatage: number;
	indicateurs: Indicateur[];
	erreursCron: {
		name: string;
		libelle: string;
		startedAt: number;
		message: string | null;
	}[];
}

function pire(a: Gravite, b: Gravite): Gravite {
	const rang = { ok: 0, attention: 1, probleme: 2 };
	return rang[a] >= rang[b] ? a : b;
}

/** Sauvegarde la plus recente, tous mecanismes confondus. */
function derniereSauvegardeFichier(): { horodatage: number | null; nom: string | null } {
	const racine = process.env.BACKUP_DIR ?? './backup';
	if (!existsSync(racine)) return { horodatage: null, nom: null };

	let meilleur: { horodatage: number; nom: string } | null = null;

	// La racine porte les sauvegardes du cron interne, `nocturne/` celles du
	// script de l'hote. On regarde les deux : ce qui compte est de savoir si
	// une copie fraiche existe quelque part, peu importe qui l'a ecrite.
	for (const repertoire of [racine, join(racine, 'nocturne')]) {
		if (!existsSync(repertoire)) continue;
		let entrees: string[];
		try {
			entrees = readdirSync(repertoire);
		} catch {
			continue;
		}
		for (const entree of entrees) {
			if (!/\.db(\.gz)?$/.test(entree)) continue;
			try {
				const s = statSync(join(repertoire, entree));
				if (!s.isFile()) continue;
				const horodatage = Math.floor(s.mtimeMs / 1000);
				if (!meilleur || horodatage > meilleur.horodatage) {
					meilleur = { horodatage, nom: entree };
				}
			} catch {
				/* fichier disparu entre readdir et stat : sans importance */
			}
		}
	}

	return meilleur ?? { horodatage: null, nom: null };
}

function dernierSucces(name: TaskName): number | null {
	const ligne = db
		.select({ startedAt: cronRuns.startedAt })
		.from(cronRuns)
		.where(and(eq(cronRuns.name, name), eq(cronRuns.status, 'ok')))
		.orderBy(desc(cronRuns.startedAt))
		.get();
	return ligne?.startedAt ?? null;
}

export function etatSysteme(): EtatSysteme {
	const maintenant = now();

	let vivant = true;
	try {
		sqlite.prepare('SELECT 1').get();
	} catch {
		vivant = false;
	}

	// « En saison » = des matchs sont proches. Sert a decider si l'absence de
	// snapshot ou de poll est anormale ou simplement l'ete.
	//
	// Les semaines de test sont exclues de tous les indicateurs qui suivent.
	// Une simulation posee un dimanche de juillet a des kickoffs a cinq minutes
	// et des cotes fraiches : sans ce filtre elle ferait croire qu'on est en
	// saison et masquerait un vrai snapshot manquant depuis trois semaines.
	const matchsProches = db
		.select({ n: sql<number>`count(*)` })
		.from(games)
		.innerJoin(weeks, eq(weeks.id, games.weekId))
		.where(
			and(
				isNull(weeks.testKind),
				gte(games.kickoffUtc, maintenant - 7 * JOUR),
				lte(games.kickoffUtc, maintenant + 14 * JOUR)
			)
		)
		.get();
	const enSaison = (matchsProches?.n ?? 0) > 0;

	const indicateurs: Indicateur[] = [];

	// --- Snapshot des cotes ---------------------------------------------------
	const snap = db
		.select({ capturedAt: oddsSnapshots.capturedAt })
		.from(oddsSnapshots)
		.innerJoin(games, eq(games.id, oddsSnapshots.gameId))
		.innerJoin(weeks, eq(weeks.id, games.weekId))
		.where(isNull(weeks.testKind))
		.orderBy(desc(oddsSnapshots.capturedAt))
		.get();
	const semaineOuverte = db
		.select({ label: weeks.label })
		.from(weeks)
		.where(and(isNull(weeks.testKind), eq(weeks.status, 'ouverte')))
		.orderBy(desc(weeks.snapshotAt))
		.get();

	const ageSnap = snap ? maintenant - snap.capturedAt : null;
	indicateurs.push({
		cle: 'snapshot',
		libelle: 'Dernier snapshot de cotes',
		gravite:
			snap === undefined
				? enSaison
					? 'probleme'
					: 'attention'
				: enSaison && ageSnap !== null && ageSnap > SEUIL_SNAPSHOT
					? 'probleme'
					: 'ok',
		horodatage: snap?.capturedAt ?? null,
		detail: semaineOuverte ? `semaine ouverte : ${semaineOuverte.label}` : 'aucune semaine ouverte'
	});

	// --- Poll des scores ------------------------------------------------------
	const dernierPoll = dernierSucces('results');
	const matchEnCours = db
		.select({ n: sql<number>`count(*)` })
		.from(games)
		.innerJoin(weeks, eq(weeks.id, games.weekId))
		.where(and(isNull(weeks.testKind), eq(games.status, 'in')))
		.get();
	const enCours = (matchEnCours?.n ?? 0) > 0;
	const agePoll = dernierPoll ? maintenant - dernierPoll : null;

	indicateurs.push({
		cle: 'poll',
		libelle: 'Dernier poll des scores',
		gravite:
			enCours && (agePoll === null || agePoll > SEUIL_POLL)
				? 'probleme'
				: enSaison && agePoll !== null && agePoll > SEUIL_POLL
					? 'attention'
					: 'ok',
		horodatage: dernierPoll,
		detail: enCours ? 'des matchs sont en direct' : 'aucun match en direct'
	});

	// --- Sauvegarde -----------------------------------------------------------
	const fichier = derniereSauvegardeFichier();
	const cronSauvegarde = dernierSucces('backup');
	// On retient la plus recente des deux traces : le script de l'hote ne passe
	// pas par `cron_runs`, le cron interne n'ecrit pas dans `nocturne/`.
	const derniereSauvegarde =
		fichier.horodatage !== null && cronSauvegarde !== null
			? Math.max(fichier.horodatage, cronSauvegarde)
			: (fichier.horodatage ?? cronSauvegarde);
	const ageSauvegarde = derniereSauvegarde ? maintenant - derniereSauvegarde : null;

	indicateurs.push({
		cle: 'sauvegarde',
		libelle: 'Derniere sauvegarde',
		gravite:
			derniereSauvegarde === null
				? 'probleme'
				: ageSauvegarde !== null && ageSauvegarde > SEUIL_SAUVEGARDE
					? 'probleme'
					: 'ok',
		horodatage: derniereSauvegarde,
		detail: fichier.nom ? `dernier fichier : ${fichier.nom}` : 'aucun fichier dans BACKUP_DIR'
	});

	// --- Erreurs de taches ----------------------------------------------------
	// Une erreur n'est signalee que si la tache n'a pas reussi depuis : un
	// echec reseau ESPN rattrape au poll suivant n'a pas a rester affiche.
	const echecs = db
		.select()
		.from(cronRuns)
		.where(and(eq(cronRuns.status, 'error'), gte(cronRuns.startedAt, maintenant - 7 * JOUR)))
		.orderBy(desc(cronRuns.startedAt))
		.all();

	const erreursCron = echecs
		.filter((echec) => {
			const succesDepuis = dernierSucces(echec.name as TaskName);
			return succesDepuis === null || succesDepuis < echec.startedAt;
		})
		.map((echec) => ({
			name: echec.name,
			libelle: TASK_LABELS[echec.name as TaskName] ?? echec.name,
			startedAt: echec.startedAt,
			message: echec.message
		}));

	indicateurs.push({
		cle: 'taches',
		libelle: 'Taches planifiees',
		gravite: erreursCron.length > 0 ? 'probleme' : 'ok',
		horodatage: erreursCron[0]?.startedAt ?? null,
		detail:
			erreursCron.length === 0
				? 'aucun echec non rattrape sur 7 jours'
				: `${erreursCron.length} echec(s) non rattrape(s)`
	});

	// --- Ordonnanceur ---------------------------------------------------------
	const cronActif = process.env.CRON_ENABLED !== '0';
	indicateurs.push({
		cle: 'ordonnanceur',
		libelle: 'Ordonnanceur',
		gravite: cronActif ? 'ok' : enSaison ? 'probleme' : 'attention',
		horodatage: null,
		detail: cronActif ? 'actif' : 'desactive (CRON_ENABLED=0)'
	});

	const gravite = indicateurs.reduce<Gravite>((acc, i) => pire(acc, i.gravite), 'ok');

	return { vivant, gravite, enSaison, horodatage: maintenant, indicateurs, erreursCron };
}
