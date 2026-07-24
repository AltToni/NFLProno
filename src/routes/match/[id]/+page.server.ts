import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { gameDetail } from '$lib/server/picks';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireUser(locals);

	const detail = gameDetail(params.id);
	if (!detail) error(404, 'Match introuvable.');

	return {
		game: detail.game,
		week: detail.week ?? null,
		odds: detail.odds ?? null,
		locked: detail.locked,
		entries: detail.entries,
		missing: detail.missing
	};
};
