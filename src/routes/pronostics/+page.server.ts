import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { PickError, savePick, weekBoard } from '$lib/server/picks';
import { currentWeek, getWeekById, listVisibleWeeks } from '$lib/server/weeks';
import { getScoringConfig } from '$lib/server/settings';
import { playoffMultiplier } from '$lib/scoring';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);

	const weeks = listVisibleWeeks();
	const requested = Number(url.searchParams.get('semaine'));
	const week =
		(Number.isFinite(requested) && requested > 0 ? getWeekById(requested) : undefined) ??
		currentWeek();

	if (!week) {
		return { week: null, weeks, games: [], multiplier: 1 };
	}

	const cfg = getScoringConfig();

	return {
		week: {
			id: week.id,
			label: week.label,
			status: week.status,
			seasontype: week.seasontype,
			number: week.number,
			snapshotAt: week.snapshotAt,
			winnerUserId: week.winnerUserId
		},
		weeks: weeks.map((w) => ({ id: w.id, label: w.label, status: w.status })),
		games: weekBoard(week.id, user.id),
		multiplier: playoffMultiplier(week.seasontype, week.number, cfg)
	};
};

export const actions: Actions = {
	pronostic: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();

		const gameId = String(form.get('gameId') ?? '');
		const pickSide = String(form.get('pickSide') ?? '');
		const scoreHomePred = Number(form.get('scoreHomePred'));
		const scoreAwayPred = Number(form.get('scoreAwayPred'));

		if (pickSide !== 'home' && pickSide !== 'away') {
			return fail(400, { gameId, error: 'Choisis une equipe avant d’enregistrer.' });
		}

		try {
			savePick({ userId: user.id, gameId, pickSide, scoreHomePred, scoreAwayPred });
		} catch (err) {
			if (err instanceof PickError) return fail(400, { gameId, error: err.message });
			throw err;
		}

		return { gameId, saved: true };
	}
};
