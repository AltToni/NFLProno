import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guards';
import { exportCsv, exportJson } from '$lib/server/export';
import { currentSeason } from '$lib/server/settings';

/** Export lisible de la saison : `?format=json` ou `?format=csv`. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals);

	const format = url.searchParams.get('format') ?? 'json';
	const demandee = Number(url.searchParams.get('saison'));
	const saison = Number.isInteger(demandee) && demandee > 2000 ? demandee : currentSeason();

	if (format !== 'json' && format !== 'csv') error(400, 'Format attendu : json ou csv.');

	const corps = format === 'csv' ? exportCsv(saison) : exportJson(saison);

	return new Response(corps, {
		headers: {
			'content-type':
				format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="pronos-nfl-${saison}.${format}"`,
			'cache-control': 'no-store'
		}
	});
};
