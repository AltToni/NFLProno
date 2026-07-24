import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from './logger';

let transporter: Transporter | null = null;
let configured: boolean | null = null;

export function mailConfigured(): boolean {
	if (configured === null) configured = Boolean(process.env.SMTP_HOST);
	return configured;
}

function getTransporter(): Transporter | null {
	if (!mailConfigured()) return null;
	if (transporter) return transporter;

	transporter = nodemailer.createTransport({
		host: process.env.SMTP_HOST,
		port: Number(process.env.SMTP_PORT ?? 587),
		secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
		auth: process.env.SMTP_USER
			? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
			: undefined
	});
	return transporter;
}

export interface MailInput {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

/**
 * Envoi SMTP. Si aucun SMTP n'est configure (dev, premier demarrage), le
 * contenu est ecrit dans les logs : le magic link reste recuperable.
 */
export async function sendMail(input: MailInput): Promise<{ sent: boolean; reason?: string }> {
	const tx = getTransporter();
	if (!tx) {
		logger.warn(
			`SMTP non configure - email non envoye a ${input.to}\n--- ${input.subject} ---\n${input.text}\n---`
		);
		return { sent: false, reason: 'smtp-absent' };
	}

	try {
		await tx.sendMail({
			from: process.env.SMTP_FROM ?? 'Pronos NFL <no-reply@localhost>',
			to: input.to,
			subject: input.subject,
			text: input.text,
			html: input.html
		});
		logger.info(`Email envoye a ${input.to} (${input.subject})`);
		return { sent: true };
	} catch (error) {
		logger.error(`Echec d'envoi a ${input.to} : ${(error as Error).message}`);
		return { sent: false, reason: (error as Error).message };
	}
}

const LAYOUT = (title: string, body: string) => `
<!doctype html>
<html lang="fr"><body style="margin:0;background:#0f1115;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaed">
	<div style="max-width:520px;margin:0 auto;background:#171a21;border:1px solid #262b36;border-radius:14px;padding:28px">
		<h1 style="margin:0 0 16px;font-size:20px;color:#e8eaed">${title}</h1>
		${body}
		<p style="margin-top:28px;font-size:12px;color:#8b93a5">Pronos NFL — jeu prive entre amis.</p>
	</div>
</body></html>`;

export function magicLinkEmail(pseudo: string, url: string): MailInput & { to: string } {
	const text = `Bonjour ${pseudo},

Voici ton lien de connexion aux Pronos NFL (valable 30 minutes, usage unique) :

${url}

Si tu n'as pas demande ce lien, ignore simplement ce message.`;

	const html = LAYOUT(
		'Ta connexion aux Pronos NFL',
		`<p style="color:#c2c8d4;line-height:1.6">Bonjour ${pseudo},</p>
		 <p style="color:#c2c8d4;line-height:1.6">Clique sur le bouton ci-dessous pour te connecter. Le lien est valable <strong>30 minutes</strong> et ne fonctionne qu'une seule fois.</p>
		 <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3ba55d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Me connecter</a></p>
		 <p style="color:#8b93a5;font-size:13px;word-break:break-all">${url}</p>`
	);

	return { to: '', subject: 'Ton lien de connexion — Pronos NFL', text, html };
}

export function reminderEmail(pseudo: string, weekLabel: string, missing: number, url: string): MailInput & { to: string } {
	const text = `Salut ${pseudo},

Il te reste ${missing} match(s) sans pronostic pour la ${weekLabel}.

Direction ${url} avant le premier kickoff.`;

	const html = LAYOUT(
		`Tu n'as pas encore tout pronostique`,
		`<p style="color:#c2c8d4;line-height:1.6">Salut ${pseudo},</p>
		 <p style="color:#c2c8d4;line-height:1.6">Il te reste <strong>${missing}</strong> match(s) sans pronostic pour la <strong>${weekLabel}</strong>.</p>
		 <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3ba55d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Faire mes pronos</a></p>`
	);

	return { to: '', subject: `Pronos NFL — ${weekLabel} : il te manque ${missing} match(s)`, text, html };
}
