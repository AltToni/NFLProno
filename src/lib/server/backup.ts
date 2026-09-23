import Database from 'better-sqlite3';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DATABASE_PATH, sqlite } from './db';
import { MIGRATIONS } from './db/migrate';
import { pendingRestorePath } from './db/pending-restore';
import { logger } from './logger';

export function backupDir(): string {
	return resolve(process.env.BACKUP_DIR ?? './backup');
}

/**
 * Nom horodate encore libre dans `dir`.
 *
 * L'horodatage descend a la seconde : deux sauvegardes rapprochees — deux clics
 * dans l'admin, ou une copie de securite prise juste apres une sauvegarde —
 * tomberaient sinon sur le meme nom, et `VACUUM INTO` echoue net sur un fichier
 * existant plutot que de l'ecraser. Le suffixe numerique garde l'ordre
 * lexicographique, dont depend la rotation.
 */
function fichierHorodate(dir: string, prefixe: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	let candidat = join(dir, `${prefixe}-${stamp}.db`);
	for (let n = 2; existsSync(candidat); n++) {
		candidat = join(dir, `${prefixe}-${stamp}-${n}.db`);
	}
	return candidat;
}

/**
 * Sauvegarde coherente du fichier SQLite (VACUUM INTO produit une copie propre,
 * meme si des ecritures sont en cours). Destination : un second disque ou un
 * partage monte sur BACKUP_DIR.
 */
export function backupDatabase(): { file: string; bytes: number; pruned: number } {
	const dir = backupDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const file = fichierHorodate(dir, 'nfl');

	sqlite.prepare('VACUUM INTO ?').run(file);
	const bytes = statSync(file).size;

	const keep = Number(process.env.BACKUP_KEEP ?? 14);
	let pruned = 0;
	if (Number.isFinite(keep) && keep > 0) {
		const files = readdirSync(dir)
			.filter((f) => f.startsWith('nfl-') && f.endsWith('.db'))
			.sort()
			.reverse();
		for (const old of files.slice(keep)) {
			rmSync(join(dir, old), { force: true });
			pruned++;
		}
	}

	logger.info(`Sauvegarde ecrite : ${file} (${Math.round(bytes / 1024)} Ko, ${pruned} purgee(s))`);
	return { file, bytes, pruned };
}

// ---------------------------------------------------------------------------
// Inventaire
// ---------------------------------------------------------------------------

export interface BackupFile {
	/** Chemin relatif a BACKUP_DIR — c'est l'identifiant manipule par l'admin. */
	name: string;
	bytes: number;
	modifiedAt: number;
	/**
	 * interne   = cron `VACUUM INTO` de l'application, sur le meme disque ;
	 * nocturne  = `scripts/backup.sh`, compresse et copie hors machine ;
	 * securite  = copie prise juste avant une restauration.
	 */
	kind: 'interne' | 'nocturne' | 'securite';
}

/**
 * Sauvegardes visibles depuis l'admin, de la plus recente a la plus ancienne.
 *
 * Les deux mecanismes du projet ecrivent a deux endroits differents (cf.
 * `scripts/README.md`) : les lister ensemble evite d'avoir a se souvenir lequel
 * a produit quoi au moment ou on en a besoin.
 */
export function listBackups(): BackupFile[] {
	const dir = backupDir();
	if (!existsSync(dir)) return [];

	const files: BackupFile[] = [];

	const ajoute = (relatif: string, kind: BackupFile['kind']) => {
		const complet = join(dir, relatif);
		try {
			const info = statSync(complet);
			if (!info.isFile()) return;
			files.push({
				name: relatif,
				bytes: info.size,
				modifiedAt: Math.floor(info.mtimeMs / 1000),
				kind
			});
		} catch {
			// Fichier disparu entre le readdir et le stat : rien a signaler.
		}
	};

	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('nfl-') && entry.endsWith('.db')) ajoute(entry, 'interne');
		else if (entry.startsWith('avant-restauration-') && entry.endsWith('.db'))
			ajoute(entry, 'securite');
	}

	const nocturne = join(dir, 'nocturne');
	if (existsSync(nocturne)) {
		for (const entry of readdirSync(nocturne)) {
			if (entry.endsWith('.db.gz') || entry.endsWith('.db')) {
				ajoute(join('nocturne', entry), 'nocturne');
			}
		}
	}

	return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * Resout un nom de sauvegarde en chemin absolu, en refusant tout ce qui sort de
 * BACKUP_DIR. Le nom vient d'un formulaire : `../../etc/passwd` doit echouer
 * ici, pas plus loin.
 */
export function resolveBackup(name: string): string {
	const dir = backupDir();
	const complet = resolve(dir, name);
	if (complet !== dir && !complet.startsWith(dir + sep)) {
		throw new Error('Nom de sauvegarde invalide.');
	}
	if (!existsSync(complet) || !statSync(complet).isFile()) {
		throw new Error(`Sauvegarde introuvable : ${name}`);
	}
	return complet;
}

/** Contenu brut d'une sauvegarde, pour le telechargement depuis l'admin. */
export function readBackup(name: string): { bytes: Buffer; filename: string } {
	const complet = resolveBackup(name);
	return { bytes: readFileSync(complet), filename: name.split('/').pop() ?? name };
}

// ---------------------------------------------------------------------------
// Restauration
// ---------------------------------------------------------------------------

export interface BackupInspection {
	users: number;
	picks: number;
	adjustments: number;
	userVersion: number;
}

/**
 * Controle d'integrite d'un fichier candidat, **avant** que quoi que ce soit
 * soit detruit. Une restauration qui remplace la base saine par une copie
 * corrompue ne vaut rien, et c'est l'unique moment ou on peut encore refuser.
 */
function inspectCandidate(path: string): BackupInspection {
	const candidat = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const integrite = candidat.pragma('integrity_check', { simple: true }) as string;
		if (integrite !== 'ok') {
			throw new Error(`sauvegarde corrompue : integrity_check a repondu « ${integrite} »`);
		}

		const userVersion = candidat.pragma('user_version', { simple: true }) as number;
		if (userVersion > MIGRATIONS.length) {
			throw new Error(
				`sauvegarde en version de schema ${userVersion}, superieure a celle que ce code ` +
					`connait (${MIGRATIONS.length}) : la restaurer rendrait la base illisible`
			);
		}

		const compte = (table: string): number => {
			try {
				return (candidat.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
			} catch {
				// Table absente : normal pour une sauvegarde anterieure a sa migration.
				return 0;
			}
		};

		const users = compte('users');
		if (users === 0) throw new Error('sauvegarde sans aucun joueur : ce n’est pas une base du jeu');

		return { users, picks: compte('picks'), adjustments: compte('score_adjustments'), userVersion };
	} finally {
		candidat.close();
	}
}

/** Decompresse si besoin et renvoie le chemin d'un fichier `.db` exploitable. */
function prepareCandidate(source: string): { path: string; temp: string | null } {
	if (!source.endsWith('.gz')) return { path: source, temp: null };

	const temp = mkdtempSync(join(tmpdir(), 'nflprono-restauration-'));
	const path = join(temp, 'restauration.db');
	writeFileSync(path, gunzipSync(readFileSync(source)));
	return { path, temp };
}

export interface RestoreResult {
	source: string;
	safety: string;
	inspection: BackupInspection;
}

/**
 * Arme une restauration : verifie la sauvegarde, met la base actuelle de cote,
 * et depose le remplacement en attente. **Le processus doit s'arreter juste
 * apres** — c'est le demarrage suivant qui met le fichier en place
 * (`db/pending-restore.ts`) et rejoue les migrations manquantes.
 *
 * L'ordre est celui de `scripts/restore.sh`, pour les memes raisons :
 *
 *   1. verifier la sauvegarde **avant** de toucher a quoi que ce soit — une
 *      restauration qui remplace la base saine par une copie corrompue ne vaut
 *      rien, et c'est le dernier moment ou on peut encore refuser ;
 *   2. mettre la base actuelle de cote (`avant-restauration-*.db`), pour que
 *      se tromper de sauvegarde reste rattrapable ;
 *   3. deposer le remplacement, sans rien detruire.
 *
 * Tant que le processus n'a pas redemarre, la base en service est intacte :
 * annuler se fait en supprimant le fichier en attente.
 */
export function restoreDatabase(name: string): RestoreResult {
	const source = resolveBackup(name);
	const { path: candidat, temp } = prepareCandidate(source);

	try {
		const inspection = inspectCandidate(candidat);

		const dir = backupDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const safety = fichierHorodate(dir, 'avant-restauration');
		sqlite.prepare('VACUUM INTO ?').run(safety);

		copyFileSync(candidat, pendingRestorePath(DATABASE_PATH));

		logger.warn(
			`Restauration armee depuis ${name} : ${inspection.users} joueur(s), ` +
				`${inspection.picks} pronostic(s). Base actuelle copiee dans ${safety}. ` +
				`Elle sera mise en place au prochain demarrage.`
		);

		return { source: name, safety, inspection };
	} finally {
		if (temp) rmSync(temp, { recursive: true, force: true });
	}
}

/** Annule une restauration armee mais pas encore appliquee. */
export function cancelPendingRestore(): boolean {
	const attente = pendingRestorePath(DATABASE_PATH);
	if (!existsSync(attente)) return false;
	rmSync(attente, { force: true });
	logger.info('Restauration en attente annulee.');
	return true;
}

/** Une restauration est-elle armee et en attente du redemarrage ? */
export function restorePending(): boolean {
	return existsSync(pendingRestorePath(DATABASE_PATH));
}
