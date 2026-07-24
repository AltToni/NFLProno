import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { findUserById } from '$lib/server/auth';
import { playerHistory, playerStats, seasonStandings } from '$lib/server/standings';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireUser(locals);

	const id = Number(params.id);
	const player = Number.isFinite(id) ? findUserById(id) : undefined;
	if (!player) error(404, 'Joueur introuvable.');

	const standings = seasonStandings();
	const rank = standings.find((row) => row.userId === player.id) ?? null;

	return {
		player: { id: player.id, pseudo: player.pseudo, avatar: player.avatar, role: player.role },
		rank,
		total: standings.length,
		stats: playerStats(player.id),
		history: playerHistory(player.id)
	};
};
