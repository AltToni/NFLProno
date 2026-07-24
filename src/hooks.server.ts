import type { Handle } from '@sveltejs/kit';
import { boot } from '$lib/server/startup';
import { SESSION_COOKIE, resolveSession } from '$lib/server/auth';

boot();

export const handle: Handle = async ({ event, resolve }) => {
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

	return resolve(event);
};
