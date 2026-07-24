import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createLoginToken,
	findUserByEmail,
	magicLinkUrl,
	normalizeEmail,
	redeemInvite
} from '$lib/server/auth';
import { magicLinkEmail, mailConfigured, sendMail } from '$lib/server/mail';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/pronostics');
	return { mailConfigured: mailConfigured() };
};

async function deliverMagicLink(userId: number, pseudo: string, email: string, origin: string) {
	const token = createLoginToken(userId);
	const url = magicLinkUrl(token, origin);
	const mail = magicLinkEmail(pseudo, url);
	return sendMail({ ...mail, to: email });
}

export const actions: Actions = {
	/** Connexion d'un joueur deja inscrit. */
	lien: async ({ request, url }) => {
		const form = await request.formData();
		const email = normalizeEmail(String(form.get('email') ?? ''));

		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			return fail(400, { form: 'lien', error: 'Adresse email invalide.', email });
		}

		const user = findUserByEmail(email);
		if (user && user.active === 1) {
			await deliverMagicLink(user.id, user.pseudo, user.email, url.origin);
		}

		// Reponse identique que le compte existe ou non : pas d'enumeration.
		return {
			form: 'lien',
			success: `Si un compte existe pour ${email}, un lien de connexion vient d'y etre envoye. Il est valable 30 minutes.`
		};
	},

	/** Premiere connexion : echange du code d'invitation contre un compte. */
	inscription: async ({ request, url }) => {
		const form = await request.formData();
		const code = String(form.get('code') ?? '');
		const email = String(form.get('email') ?? '');
		const pseudo = String(form.get('pseudo') ?? '');

		const result = redeemInvite(code, email, pseudo);
		if (!result.ok || !result.user) {
			return fail(400, { form: 'inscription', error: result.error, code, email, pseudo });
		}

		await deliverMagicLink(result.user.id, result.user.pseudo, result.user.email, url.origin);

		return {
			form: 'inscription',
			success: `Bienvenue ${result.user.pseudo} ! Un lien de connexion vient d'etre envoye a ${result.user.email}.`
		};
	}
};
