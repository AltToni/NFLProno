import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sqlite } from './db';
import { logger } from './logger';

/**
 * Sauvegarde coherente du fichier SQLite (VACUUM INTO produit une copie propre,
 * meme si des ecritures sont en cours). Destination : un second disque ou un
 * partage monte sur BACKUP_DIR.
 */
export function backupDatabase(): { file: string; bytes: number; pruned: number } {
	const dir = process.env.BACKUP_DIR ?? './backup';
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const file = join(dir, `nfl-${stamp}.db`);

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
