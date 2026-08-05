import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guards';
import { PickError, savePick, weekBoard } from '$lib/server/picks';
import { defaultWeek, getWeekById, listVisibleWeeks } from '$lib/server/weeks';
import { getScoringConfig } from '$lib/server/settings';
import { playoffMultiplier } from '$lib/scoring';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);

	const weeks = listVisibleWeeks();
	const requested = Number(url.searchParams.get('semaine'));
	const week =
		(Number.isFinite(requested) && requested > 0 ? getWeekById(requested) : undefined) ??
		defaultWeek();

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
		multiplier: playoffMultiplier(week.seasontype, week.number, cfg),
		// Le bareme voyage jusqu'aux cartes : c'est lui qui decide du bonus
		// annonce sous la saisie, et il doit suivre les reglages de l'admin.
		bareme: cfg
	};
};

/** Champ numerique : entier explicite, ou null si absent, vide ou mal forme. */
function parseScore(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	return Number(trimmed);
}

export interface ResultatEnregistrement {
	/** Nombre de pronostics reellement ecrits. */
	enregistres: number;
	/** Message par match, pour la carte concernee. */
	erreurs: Record<string, string>;
	/** Matchs encore sans pronostic apres l'enregistrement. */
	manquants: string[];
}

export const actions: Actions = {
	/**
	 * Enregistrement de toute la grille en une fois. Chaque carte est traitee
	 * independamment : une saisie incomplete ou refusee n'empeche jamais les
	 * autres d'etre ecrites, elle remonte comme message sur sa propre carte. Ce
	 * qui n'a pas ete touche du tout n'est pas une erreur — c'est un
	 * avertissement, rendu par la page.
	 */
	pronostics: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();

		const jeux = form.getAll('jeu').map(String).filter(Boolean);
		const resultat: ResultatEnregistrement = { enregistres: 0, erreurs: {}, manquants: [] };

		const champ = (nom: string, gameId: string) => form.get(`${nom}:${gameId}`);

		for (const gameId of jeux) {
			const rawMode = String(champ('mode', gameId) ?? 'margin');
			if (rawMode !== 'score' && rawMode !== 'margin') {
				resultat.erreurs[gameId] = 'Mode de saisie invalide.';
				continue;
			}

			const rawSide = String(champ('side', gameId) ?? '');
			const pickSide = rawSide === 'home' || rawSide === 'away' ? rawSide : null;
			// Drapeau indicatif : au pire on reecrit un pronostic identique, jamais
			// on n'en perd un. Il evite de repousser `updated_at` sur seize matchs a
			// chaque enregistrement.
			const modifie = String(champ('modifie', gameId) ?? '') === '1';

			/**
			 * `Number(null)` et `Number('')` valent 0, et 0 est une valeur valide
			 * dans les deux modes (score 0-0, ou nul predit). Sans ce controle, un
			 * envoi sans les cases attendues — le chemin sans JavaScript,
			 * notamment — enregistrerait silencieusement un pari sur le match nul a
			 * la place du pronostic du joueur.
			 */
			if (rawMode === 'margin') {
				const marginPred = parseScore(champ('margin', gameId));

				if (marginPred === null) {
					// Carte vierge : pas une erreur, juste un pronostic qui manque.
					if (pickSide === null) {
						resultat.manquants.push(gameId);
					} else {
						resultat.erreurs[gameId] = 'Annonce un ecart, ou choisis « Match nul ».';
					}
					continue;
				}

				if (!modifie) continue;

				try {
					savePick({ userId: user.id, gameId, mode: 'margin', pickSide, marginPred });
					resultat.enregistres++;
				} catch (err) {
					if (!(err instanceof PickError)) throw err;
					resultat.erreurs[gameId] = err.message;
				}
				continue;
			}

			const scoreHomePred = parseScore(champ('home', gameId));
			const scoreAwayPred = parseScore(champ('away', gameId));

			if (pickSide === null && scoreHomePred === null && scoreAwayPred === null) {
				resultat.manquants.push(gameId);
				continue;
			}
			if (scoreHomePred === null || scoreAwayPred === null) {
				resultat.erreurs[gameId] = 'Renseigne les deux scores.';
				continue;
			}
			if (pickSide === null) {
				resultat.erreurs[gameId] = 'Choisis l’equipe a crediter si le match ne finit pas nul.';
				continue;
			}

			if (!modifie) continue;

			try {
				savePick({
					userId: user.id,
					gameId,
					mode: 'score',
					pickSide,
					scoreHomePred,
					scoreAwayPred
				});
				resultat.enregistres++;
			} catch (err) {
				if (!(err instanceof PickError)) throw err;
				resultat.erreurs[gameId] = err.message;
			}
		}

		// `fail` repeint les cartes fautives en rouge sans perdre ce qui a ete
		// enregistre : les deux informations voyagent dans la meme reponse.
		return Object.keys(resultat.erreurs).length > 0 ? fail(400, resultat) : resultat;
	}
};
