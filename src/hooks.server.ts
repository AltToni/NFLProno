import type { Handle, HandleServerError } from '@sveltejs/kit';
import { boot } from '$lib/server/startup';
import { SESSION_COOKIE, resolveSession } from '$lib/server/auth';
import { logger } from '$lib/server/logger';

boot();

/**
 * En-tetes de securite ajoutes a toutes les reponses.
 *
 * Le CSP n'est pas ici : il est declare dans `svelte.config.js`, ou SvelteKit
 * peut calculer les hashes de ses propres scripts inline.
 */
const ENTETES: Record<string, string> = {
	// Le navigateur ne doit pas deviner un type MIME : une reponse JSON servie
	// par erreur en HTML ne doit pas s'executer.
	'X-Content-Type-Options': 'nosniff',
	// Double emploi avec `frame-ancestors 'none'` du CSP, garde pour les
	// navigateurs qui ignorent la directive.
	'X-Frame-Options': 'DENY',
	// Une URL de magic link ne doit jamais partir dans un Referer vers un tiers.
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'X-Robots-Tag': 'noindex, nofollow'
};

/** Chemins dont on ne journalise pas les acces : ils tournent en boucle. */
const SILENCIEUX = new Set(['/api/health']);

export const handle: Handle = async ({ event, resolve }) => {
	const debut = Date.now();

	const token = event.cookies.get(SESSION_COOKIE);
	const user = resolveSession(token);

	event.locals.user = user
		? {
				id: user.id,
				pseudo: user.pseudo,
				email: user.email,
				role: user.role,
				avatar: user.avatar
			}
		: null;

	const reponse = await resolve(event);

	for (const [nom, valeur] of Object.entries(ENTETES)) {
		reponse.headers.set(nom, valeur);
	}

	// HSTS uniquement si le site est reellement servi en HTTPS : l'envoyer en
	// clair sur http://localhost verrouillerait le navigateur du developpeur
	// sur une origine qui n'a pas de certificat.
	const base = process.env.PUBLIC_BASE_URL ?? '';
	if (base.startsWith('https://')) {
		reponse.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	if (!SILENCIEUX.has(event.url.pathname)) {
		// Seulement le chemin, jamais la chaine de requete : `/connexion/verifier`
		// porte le jeton de connexion en clair dans l'URL.
		logger.info('requete', {
			methode: event.request.method,
			chemin: event.url.pathname,
			statut: reponse.status,
			ms: Date.now() - debut,
			utilisateur: event.locals.user?.id ?? null
		});
	}

	return reponse;
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// Les 404 sont du bruit ; le reste merite une trace avec sa pile.
	if (status !== 404) {
		logger.error('erreur non geree', {
			chemin: event.url.pathname,
			statut: status,
			message,
			detail: error instanceof Error ? error.stack : String(error)
		});
	}
	// Ce qui est renvoye au client reste volontairement vague.
	return { message: status === 404 ? 'Page introuvable.' : 'Une erreur est survenue.' };
};
