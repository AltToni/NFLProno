import { error, redirect } from '@sveltejs/kit';

export function requireUser(locals: App.Locals): App.SessionUser {
	if (!locals.user) redirect(303, '/connexion');
	return locals.user;
}

export function requireAdmin(locals: App.Locals): App.SessionUser {
	const user = requireUser(locals);
	if (user.role !== 'admin') error(403, 'Reserve aux administrateurs.');
	return user;
}
