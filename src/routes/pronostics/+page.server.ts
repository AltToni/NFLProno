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
			winnerUserId: week.winnerUserId,
			testKind: week.testKind,
			sourceSeason: week.sourceSeason
		},
		weeks: weeks.map((w) => ({
			id: w.id,
			label: w.label,
			status: w.status,
			testKind: w.testKind
		})),
		games: weekBoard(week.id, user.id),
		multiplier: playoffMultiplier(week.seasontype, week.number, cfg)
	};
};

/** Champ de score : entier explicite, ou null si absent, vide ou mal forme. */
function parseScore(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	return Number(trimmed);
}

export const actions: Actions = {
	pronostic: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();

		const gameId = String(form.get('gameId') ?? '');
		const pickSide = String(form.get('pickSide') ?? '');

		/**
		 * `Number(null)` et `Number('')` valent 0, et 0-0 est un pronostic valide
		 * (nul predit). Sans ce controle, un envoi sans les cases de score — le
		 * chemin sans JavaScript, notamment — enregistrerait silencieusement un
		 * pari sur le match nul a la place du pronostic du joueur.
		 */
		const scoreHomePred = parseScore(form.get('scoreHomePred'));
		const scoreAwayPred = parseScore(form.get('scoreAwayPred'));

		if (pickSide !== 'home' && pickSide !== 'away') {
			return fail(400, { gameId, error: 'Choisis une equipe avant d’enregistrer.' });
		}

		if (scoreHomePred === null || scoreAwayPred === null) {
			return fail(400, { gameId, error: 'Renseigne les deux scores avant d’enregistrer.' });
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
