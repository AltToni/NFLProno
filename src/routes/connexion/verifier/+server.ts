import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, consumeLoginToken, createSession } from '$lib/server/auth';

export const GET: RequestHandler = async ({ url, cookies, request }) => {
	const token = url.searchParams.get('token');
	if (!token) redirect(303, '/connexion?erreur=jeton-manquant');

	const user = consumeLoginToken(token);
	if (!user) redirect(303, '/connexion?erreur=jeton-invalide');

	const session = createSession(user.id, request.headers.get('user-agent'));

	cookies.set(SESSION_COOKIE, session, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 24 * 3600
	});

	redirect(303, '/pronostics');
};
