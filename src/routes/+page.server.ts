import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { weekBoard } from '$lib/server/picks';
import { defaultWeek, listVisibleWeeks } from '$lib/server/weeks';
import { seasonStandings } from '$lib/server/standings';
import { latestResults, leagueInfo, recap, recentActivity } from '$lib/server/home';

/**
 * Accueil.
 *
 * Le visiteur non connecte repart sur `/connexion` : cette page est
 * entierement personnelle, elle n'a rien a montrer sans compte.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) redirect(303, '/connexion');

	const week = defaultWeek();
	const board = week ? weekBoard(week.id, user.id) : [];

	/*
	 * Le compte de matchs restants se lit sur la grille deja chargee, pas sur
	 * une requete a part : `locked` y tient compte de la neutralisation du
	 * verrouillage sur les semaines de rejeu, ce qu'un `kickoff > now()` en SQL
	 * ignorerait. Les deux affichages ne peuvent donc pas diverger.
	 */
	const ouverts = board.filter((g) => !g.locked && !g.neutralized);
	const restants = ouverts.filter((g) => g.pick === null).length;

	const classement = seasonStandings();

	return {
		week: week
			? { id: week.id, label: week.label, status: week.status, testKind: week.testKind }
			: null,
		/** Les quatre prochains matchs a jouer ; a defaut, le debut de la grille. */
		matchs: (ouverts.length > 0 ? ouverts : board).slice(0, 4),
		total: board.length,
		restants,
		ouverts: ouverts.length,
		recap: recap(user.id, week?.id ?? null),
		activite: recentActivity(6),
		resultats: latestResults(4),
		ligue: leagueInfo(),
		classement: classement.slice(0, 8),
		monRang: classement.find((r) => r.userId === user.id) ?? null
	};
};
