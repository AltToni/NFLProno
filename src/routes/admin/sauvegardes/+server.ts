import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guards';
import { readBackup } from '$lib/server/backup';

/**
 * Telechargement d'une sauvegarde.
 *
 * Le `+layout.server.ts` de `/admin` ne protege que les pages : un endpoint a
 * sa propre garde, sans quoi le fichier serait servi a n'importe qui.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals);

	const nom = url.searchParams.get('fichier') ?? '';
	if (!nom) error(400, 'Preciser le fichier a telecharger.');

	let fichier: { bytes: Buffer; filename: string };
	try {
		// `readBackup` refuse tout chemin sortant de BACKUP_DIR.
		fichier = readBackup(nom);
	} catch (err) {
		error(404, (err as Error).message);
	}

	return new Response(new Uint8Array(fichier.bytes), {
		headers: {
			'content-type': fichier.filename.endsWith('.gz')
				? 'application/gzip'
				: 'application/vnd.sqlite3',
			'content-length': String(fichier.bytes.byteLength),
			'content-disposition': `attachment; filename="${fichier.filename.replace(/"/g, '')}"`,
			'cache-control': 'no-store'
		}
	});
};
