import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sqlite } from '$lib/server/db';
import { etatSysteme } from '$lib/server/health';

/**
 * Sonde de vivacite, utilisee par le HEALTHCHECK Docker et le compose.
 *
 * Le code HTTP ne reflete QUE la vivacite : 200 si la base s'ouvre, 503 sinon.
 * La fraicheur (snapshot ancien, sauvegarde manquante, tache en echec) est
 * exposee dans la charge utile mais ne change pas le code — sans quoi Docker
 * redemarrerait le conteneur en boucle chaque intersaison, et un poll ESPN
 * rate suffirait a le tuer.
 *
 * Le detail operationnel n'est servi qu'a un administrateur connecte : il dit
 * quand la base a ete sauvegardee et ce qui casse, ce qui n'a rien a faire sur
 * une URL publique.
 */
export const GET: RequestHandler = ({ locals }) => {
	try {
		sqlite.prepare('SELECT 1').get();
	} catch (error) {
		return json({ ok: false, error: (error as Error).message }, { status: 503 });
	}

	const base = { ok: true, ts: Math.floor(Date.now() / 1000) };

	if (locals.user?.role !== 'admin') return json(base);

	const etat = etatSysteme();
	return json({
		...base,
		gravite: etat.gravite,
		enSaison: etat.enSaison,
		indicateurs: etat.indicateurs.map((i) => ({
			cle: i.cle,
			gravite: i.gravite,
			horodatage: i.horodatage,
			detail: i.detail
		})),
		erreursCron: etat.erreursCron
	});
};
