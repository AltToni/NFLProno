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
import {
	consommer,
	journaliserRefus,
	messageQuota,
	reinitialiser,
	QUOTA_INSCRIPTION_PAR_IP,
	QUOTA_LIEN_PAR_EMAIL,
	QUOTA_LIEN_PAR_IP
} from '$lib/server/ratelimit';

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
	lien: async ({ request, url, getClientAddress }) => {
		const form = await request.formData();
		const email = normalizeEmail(String(form.get('email') ?? ''));

		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			return fail(400, { form: 'lien', error: 'Adresse email invalide.', email });
		}

		// Les deux quotas sont consommes avant de savoir si le compte existe :
		// une reponse plus rapide pour une adresse inconnue serait un canal
		// d'enumeration a elle seule.
		const parIp = consommer(`ip:${getClientAddress()}`, QUOTA_LIEN_PAR_IP);
		if (!parIp.autorise) {
			journaliserRefus('lien', `ip:${getClientAddress()}`, parIp);
			return fail(429, { form: 'lien', error: messageQuota(parIp), email });
		}

		const parEmail = consommer(`email:${email}`, QUOTA_LIEN_PAR_EMAIL);
		if (!parEmail.autorise) {
			journaliserRefus('lien', `email:${email}`, parEmail);
			return fail(429, { form: 'lien', error: messageQuota(parEmail), email });
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
	inscription: async ({ request, url, getClientAddress }) => {
		const form = await request.formData();
		const code = String(form.get('code') ?? '');
		const email = String(form.get('email') ?? '');
		const pseudo = String(form.get('pseudo') ?? '');

		const cle = `ip:${getClientAddress()}`;
		const verdict = consommer(cle, QUOTA_INSCRIPTION_PAR_IP);
		if (!verdict.autorise) {
			journaliserRefus('inscription', cle, verdict);
			return fail(429, {
				form: 'inscription',
				error: messageQuota(verdict),
				code,
				email,
				pseudo
			});
		}

		const result = redeemInvite(code, email, pseudo);
		if (!result.ok || !result.user) {
			return fail(400, { form: 'inscription', error: result.error, code, email, pseudo });
		}

		// Le code etait bon : cette IP n'est pas en train de balayer, on lui rend
		// son quota pour ne pas penaliser une famille derriere la meme adresse.
		reinitialiser(cle);

		await deliverMagicLink(result.user.id, result.user.pseudo, result.user.email, url.origin);

		return {
			form: 'inscription',
			success: `Bienvenue ${result.user.pseudo} ! Un lien de connexion vient d'etre envoye a ${result.user.email}.`
		};
	}
};
