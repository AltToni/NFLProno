import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Sauvegarde et restauration sur une base jetable.
 *
 * Ce qui est reellement eprouve ici est l'aller-retour : sauvegarder, modifier
 * la base, restaurer, et **retrouver l'etat sauvegarde**. Une sauvegarde dont
 * on n'a jamais verifie qu'elle se restaure n'est pas une sauvegarde, c'est un
 * fichier.
 *
 * Deux garde-fous sont testes a part, parce que ce sont eux qui transforment
 * une fausse manoeuvre en perte de donnees : le refus d'une sauvegarde
 * corrompue, et le refus d'un chemin sortant de BACKUP_DIR.
 */

let repertoire: string;
let baseDir: string;
let sauvegardeDir: string;

type Modules = {
	db: typeof import('./db');
	schema: typeof import('./db/schema');
	backup: typeof import('./backup');
	pending: typeof import('./db/pending-restore');
};

let m: Modules;

beforeAll(async () => {
	repertoire = mkdtempSync(join(tmpdir(), 'nflprono-backup-'));
	baseDir = join(repertoire, 'data');
	sauvegardeDir = join(repertoire, 'backup');

	process.env.DATABASE_PATH = join(baseDir, 'nfl.db');
	process.env.BACKUP_DIR = sauvegardeDir;
	process.env.CRON_ENABLED = '0';

	m = {
		db: await import('./db'),
		schema: await import('./db/schema'),
		backup: await import('./backup'),
		pending: await import('./db/pending-restore')
	};

	m.db.db
		.insert(m.schema.users)
		.values({ pseudo: 'Ana', email: 'ana@example.invalid', createdAt: 0 })
		.run();
});

afterAll(() => {
	try {
		m?.db?.sqlite?.close();
	} catch {
		// Deja fermee par le test d'aller-retour.
	}
	rmSync(repertoire, { recursive: true, force: true });
});

/** Nombre de joueurs lu sur le fichier, hors de toute connexion applicative. */
function joueursDansLeFichier(path: string): number {
	const base = new Database(path, { readonly: true, fileMustExist: true });
	try {
		return (base.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
	} finally {
		base.close();
	}
}

describe('backupDatabase', () => {
	it('ecrit une copie exploitable et la fait apparaitre dans l’inventaire', () => {
		const rapport = m.backup.backupDatabase();
		expect(existsSync(rapport.file)).toBe(true);
		expect(rapport.bytes).toBeGreaterThan(0);
		expect(joueursDansLeFichier(rapport.file)).toBe(1);

		const inventaire = m.backup.listBackups();
		expect(inventaire).toHaveLength(1);
		expect(inventaire[0]).toMatchObject({ kind: 'interne' });
		expect(inventaire[0].name.endsWith('.db')).toBe(true);
	});

	it('classe les sauvegardes compressees du script hote a part', () => {
		// `scripts/backup.sh` ecrit des .db.gz dans un sous-repertoire : l'admin
		// doit les voir, ce sont les seules qui sortent de la machine.
		const source = join(sauvegardeDir, m.backup.listBackups()[0].name);
		const nocturne = join(sauvegardeDir, 'nocturne');
		mkdirSync(nocturne, { recursive: true });
		writeFileSync(join(nocturne, 'nflprono-20260101-043000.db.gz'), gzipSync(readFileSync(source)));

		const inventaire = m.backup.listBackups();
		expect(inventaire.map((f) => f.kind).sort()).toEqual(['interne', 'nocturne']);
	});

	it('ignore ce qui n’est pas une sauvegarde', () => {
		writeFileSync(join(sauvegardeDir, 'notes.txt'), 'pas une sauvegarde');
		expect(m.backup.listBackups().some((f) => f.name === 'notes.txt')).toBe(false);
		rmSync(join(sauvegardeDir, 'notes.txt'), { force: true });
	});
});

describe('resolveBackup', () => {
	it('refuse un chemin qui sort de BACKUP_DIR', () => {
		expect(() => m.backup.resolveBackup('../data/nfl.db')).toThrow(/invalide/);
		expect(() => m.backup.resolveBackup('/etc/passwd')).toThrow(/invalide/);
	});

	it('refuse un fichier inexistant', () => {
		expect(() => m.backup.resolveBackup('nfl-jamais-ecrite.db')).toThrow(/introuvable/);
	});
});

describe('restoreDatabase — refus', () => {
	it('refuse un fichier qui n’est pas une base SQLite', () => {
		writeFileSync(join(sauvegardeDir, 'nfl-bidon.db'), 'ceci n’est pas une base');
		expect(() => m.backup.restoreDatabase('nfl-bidon.db')).toThrow();
		expect(m.backup.restorePending()).toBe(false);
		rmSync(join(sauvegardeDir, 'nfl-bidon.db'), { force: true });
	});

	it('refuse une base SQLite valide mais vide de joueurs', () => {
		// Le cas pernicieux : le fichier passe `integrity_check`, et pourtant le
		// restaurer effacerait la ligue.
		const etrangere = join(sauvegardeDir, 'nfl-etrangere.db');
		const base = new Database(etrangere);
		base.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
		base.close();

		expect(() => m.backup.restoreDatabase('nfl-etrangere.db')).toThrow(/aucun joueur/);
		expect(m.backup.restorePending()).toBe(false);
		rmSync(etrangere, { force: true });
	});
});

describe('restoreDatabase — sauvegarde compressee', () => {
	it('decompresse et verifie un .db.gz du script hote', () => {
		const gz = m.backup.listBackups().find((f) => f.kind === 'nocturne')!;
		const rapport = m.backup.restoreDatabase(gz.name);
		expect(rapport.inspection.users).toBe(1);
		expect(m.backup.restorePending()).toBe(true);

		m.backup.cancelPendingRestore();
	});
});

describe('restoreDatabase — aller-retour', () => {
	let sauvegarde: string;

	it('arme la restauration sans rien detruire', () => {
		sauvegarde = m.backup.listBackups().find((f) => f.kind === 'interne')!.name;

		// La base evolue apres la sauvegarde : c'est cet ajout que la
		// restauration doit faire disparaitre.
		m.db.db
			.insert(m.schema.users)
			.values({ pseudo: 'Bo', email: 'bo@example.invalid', createdAt: 0 })
			.run();
		expect(joueursDansLeFichier(m.db.DATABASE_PATH)).toBe(2);

		const rapport = m.backup.restoreDatabase(sauvegarde);
		expect(rapport.inspection.users).toBe(1);
		expect(existsSync(rapport.safety)).toBe(true);
		// La copie de securite contient bien l'etat *actuel*, pas le restaure.
		expect(joueursDansLeFichier(rapport.safety)).toBe(2);

		// Rien n'a bouge : la base en service est intacte, l'application tourne.
		expect(m.backup.restorePending()).toBe(true);
		expect(joueursDansLeFichier(m.db.DATABASE_PATH)).toBe(2);
	});

	it('s’annule tant que le redemarrage n’a pas eu lieu', () => {
		expect(m.backup.cancelPendingRestore()).toBe(true);
		expect(m.backup.restorePending()).toBe(false);
		expect(m.backup.cancelPendingRestore()).toBe(false);
	});

	it('remplace la base au demarrage suivant', () => {
		m.backup.restoreDatabase(sauvegarde);
		expect(m.backup.restorePending()).toBe(true);

		// Ce que fait `db/index.ts` avant d'ouvrir la base, au demarrage.
		m.db.sqlite.close();
		expect(m.pending.applyPendingRestore(m.db.DATABASE_PATH)).toBe(true);

		// Bo n'existe plus : c'est l'etat sauvegarde qui est en place.
		expect(joueursDansLeFichier(m.db.DATABASE_PATH)).toBe(1);
		expect(m.backup.restorePending()).toBe(false);
		expect(existsSync(`${m.db.DATABASE_PATH}-wal`)).toBe(false);
	});

	it('ne fait rien quand aucune restauration n’attend', () => {
		expect(m.pending.applyPendingRestore(m.db.DATABASE_PATH)).toBe(false);
	});
});
