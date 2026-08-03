import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { rankEvolution, seasonStandings, weekStandings } from '$lib/server/standings';
import { defaultWeek, getWeekById, listVisibleWeeks } from '$lib/server/weeks';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals);

	const weeks = listVisibleWeeks();
	const requested = Number(url.searchParams.get('semaine'));
	const week =
		(Number.isFinite(requested) && requested > 0 ? getWeekById(requested) : undefined) ??
		defaultWeek();

	return {
		season: seasonStandings(),
		weekly: week ? weekStandings(week.id) : [],
		week: week
			? { id: week.id, label: week.label, status: week.status, testKind: week.testKind }
			: null,
		weeks: weeks.map((w) => ({ id: w.id, label: w.label, testKind: w.testKind })),
		evolution: rankEvolution()
	};
};
