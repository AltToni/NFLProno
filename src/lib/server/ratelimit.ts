import { logger } from './logger';

/**
 * Limitation de debit, en memoire.
 *
 * Le jeu tourne dans un unique conteneur, un unique process : un compteur en
 * memoire suffit et evite une dependance (Redis) pour 25 joueurs. Le prix a
 * payer est assume : **les compteurs repartent de zero a chaque redemarrage**.
 * Ca n'a pas d'importance ici — on protege d'un envoi massif d'emails et d'un
 * balayage de codes d'invitation, pas d'un attaquant qui pourrait redemarrer
 * le conteneur.
 *
 * Si l'application passe un jour a plusieurs instances, ce module est le
 * premier a remplacer : chaque instance compterait dans son coin.
 */

interface Fenetre {
	/** Horodatages (ms) des tentatives encore dans la fenetre. */
	tentatives: number[];
}

const compteurs = new Map<string, Fenetre>();

/** Purge paresseuse : declenchee par les appels, pas par un minuteur. */
let dernierNettoyage = 0;
const INTERVALLE_NETTOYAGE = 5 * 60_000;

function nettoyer(maintenant: number, fenetreMs: number): void {
	if (maintenant - dernierNettoyage < INTERVALLE_NETTOYAGE) return;
	dernierNettoyage = maintenant;
	for (const [cle, fenetre] of compteurs) {
		fenetre.tentatives = fenetre.tentatives.filter((t) => maintenant - t < fenetreMs);
		if (fenetre.tentatives.length === 0) compteurs.delete(cle);
	}
}

export interface Quota {
	/** Nombre de tentatives autorisees dans la fenetre. */
	max: number;
	/** Largeur de la fenetre glissante, en secondes. */
	fenetreSecondes: number;
}

export interface Verdict {
	autorise: boolean;
	restant: number;
	/** Secondes avant qu'une nouvelle tentative passe. 0 si autorise. */
	attendre: number;
}

/**
 * Enregistre une tentative et dit si elle passe. Fenetre glissante : on garde
 * les horodatages plutot qu'un compteur remis a zero, sinon un attaquant fait
 * `max` tentatives en fin de fenetre puis `max` au debut de la suivante.
 */
export function consommer(cle: string, quota: Quota): Verdict {
	const maintenant = Date.now();
	const fenetreMs = quota.fenetreSecondes * 1000;
	nettoyer(maintenant, fenetreMs);

	let fenetre = compteurs.get(cle);
	if (!fenetre) {
		fenetre = { tentatives: [] };
		compteurs.set(cle, fenetre);
	}

	fenetre.tentatives = fenetre.tentatives.filter((t) => maintenant - t < fenetreMs);

	if (fenetre.tentatives.length >= quota.max) {
		const plusAncienne = fenetre.tentatives[0];
		const attendre = Math.max(1, Math.ceil((fenetreMs - (maintenant - plusAncienne)) / 1000));
		return { autorise: false, restant: 0, attendre };
	}

	fenetre.tentatives.push(maintenant);
	return { autorise: true, restant: quota.max - fenetre.tentatives.length, attendre: 0 };
}

/** Efface le compteur d'une cle : appele apres une reussite legitime. */
export function reinitialiser(cle: string): void {
	compteurs.delete(cle);
}

/** Pour les tests. */
export function viderTout(): void {
	compteurs.clear();
	dernierNettoyage = 0;
}

// ---------------------------------------------------------------------------
// Quotas de l'application
// ---------------------------------------------------------------------------

/**
 * Demande de magic link. Deux quotas simultanes :
 *
 *  - par email, pour qu'on ne puisse pas inonder la boite d'un joueur ;
 *  - par IP, pour qu'on ne puisse pas balayer une liste d'adresses ni epuiser
 *    le quota d'envoi du serveur SMTP.
 *
 * Trois liens par quart d'heure couvre largement l'usage normal : un lien vaut
 * 30 minutes, en redemander un troisieme signale deja un probleme ailleurs.
 */
export const QUOTA_LIEN_PAR_EMAIL: Quota = { max: 3, fenetreSecondes: 15 * 60 };
export const QUOTA_LIEN_PAR_IP: Quota = { max: 10, fenetreSecondes: 15 * 60 };

/** Echange d'un code d'invitation : freine un balayage de codes. */
export const QUOTA_INSCRIPTION_PAR_IP: Quota = { max: 10, fenetreSecondes: 60 * 60 };

/**
 * Message unique, volontairement identique quel que soit le quota atteint :
 * il ne doit pas laisser deviner si l'adresse existe.
 */
export function messageQuota(verdict: Verdict): string {
	const minutes = Math.ceil(verdict.attendre / 60);
	return minutes <= 1
		? 'Trop de tentatives. Reessaie dans une minute.'
		: `Trop de tentatives. Reessaie dans ${minutes} minutes.`;
}

export function journaliserRefus(action: string, cle: string, verdict: Verdict): void {
	logger.warn('Limitation de debit atteinte', {
		action,
		// La cle porte un email ou une IP : on journalise le type, pas la valeur.
		cle: cle.split(':')[0],
		attendre: verdict.attendre
	});
}
