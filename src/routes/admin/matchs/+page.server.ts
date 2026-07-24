import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { games } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { currentWeek, getWeekById, listWeeks, weekGames } from '$lib/server/weeks';
import { computeGameScores } from '$lib/server/results';
import { now } from '$lib/time';

export const load: PageServerLoad = async ({ url }) => {
	const weeks = listWeeks();
	const requested = Number(url.searchParams.get('semaine'));
	const week =
		(Number.isFinite(requested) && requested > 0 ? getWeekById(requested) : undefined) ??
		currentWeek() ??
		weeks[0];

	return {
		weeks: weeks.map((w) => ({ id: w.id, label: w.label, status: w.status })),
		week: week ? { id: week.id, label: week.label, status: week.status } : null,
		games: week ? weekGames(week.id) : []
	};
};

export const actions: Actions = {
	/** Correction manuelle : fige le score et empeche le poll ESPN de l'ecraser. */
	corriger: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();

		const gameId = String(form.get('gameId') ?? '');
		const status = String(form.get('status') ?? 'final');
		const neutralized = form.get('neutralized') === 'on' ? 1 : 0;
		const scoreHomeRaw = form.get('scoreHome');
		const scoreAwayRaw = form.get('scoreAway');

		const game = db.select().from(games).where(eq(games.id, gameId)).get();
		if (!game) return fail(404, { error: 'Match introuvable.' });

		const parse = (value: FormDataEntryValue | null) => {
			if (value === null || String(value).trim() === '') return null;
			const n = Number(value);
			return Number.isInteger(n) && n >= 0 && n <= 199 ? n : NaN;
		};

		const scoreHome = parse(scoreHomeRaw);
		const scoreAway = parse(scoreAwayRaw);
		if (Number.isNaN(scoreHome) || Number.isNaN(scoreAway)) {
			return fail(400, { error: 'Scores invalides (entiers entre 0 et 199).' });
		}
		if (status === 'final' && (scoreHome === null || scoreAway === null)) {
			return fail(400, { error: 'Un match final doit avoir deux scores.' });
		}

		db.update(games)
			.set({
				status,
				scoreHome,
				scoreAway,
				neutralized,
				manualOverride: 1,
				statusDetail: 'Corrige manuellement',
				updatedAt: now()
			})
			.where(eq(games.id, gameId))
			.run();

		const report = computeGameScores(gameId);

		return {
			ok:
				`${game.awayAbbr} @ ${game.homeAbbr} corrige. ` +
				`${report.picksScored} pronostic(s) recalcule(s).`
		};
	},

	/** Rend la main au flux ESPN pour ce match. */
	auto: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const gameId = String(form.get('gameId') ?? '');
		const game = db.select().from(games).where(eq(games.id, gameId)).get();
		if (!game) return fail(404, { error: 'Match introuvable.' });

		db.update(games)
			.set({ manualOverride: 0, statusDetail: null, updatedAt: now() })
			.where(eq(games.id, gameId))
			.run();

		return { ok: `${game.awayAbbr} @ ${game.homeAbbr} : synchronisation ESPN retablie.` };
	}
};
