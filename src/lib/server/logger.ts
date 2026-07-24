/**
 * Journalisation.
 *
 * En production, une ligne = un objet JSON : c'est ce que savent lire
 * `docker logs`, jq, Loki et n'importe quel collecteur. En developpement, le
 * format lisible d'origine est conserve — du JSON dans un terminal pendant
 * qu'on code n'aide personne.
 *
 * `LOG_FORMAT=json|texte` force le choix si besoin.
 */

export type Niveau = 'info' | 'warn' | 'error';

export type Contexte = Record<string, unknown>;

function formatJson(): boolean {
	const force = process.env.LOG_FORMAT;
	if (force === 'json') return true;
	if (force === 'texte') return false;
	return process.env.NODE_ENV === 'production';
}

const SORTIE: Record<Niveau, (ligne: string) => void> = {
	info: console.log,
	warn: console.warn,
	error: console.error
};

function emettre(niveau: Niveau, message: string, contexte?: Contexte): void {
	const ts = new Date().toISOString();

	if (formatJson()) {
		// `message` et `niveau` sont ecrits apres l'etalement du contexte : une
		// cle homonyme dans le contexte ne doit pas les remplacer.
		SORTIE[niveau](JSON.stringify({ ts, ...contexte, niveau, message }));
		return;
	}

	const suffixe =
		contexte && Object.keys(contexte).length
			? ' ' +
				Object.entries(contexte)
					.map(
						([cle, valeur]) =>
							`${cle}=${typeof valeur === 'string' ? valeur : JSON.stringify(valeur)}`
					)
					.join(' ')
			: '';
	SORTIE[niveau](`[${ts}] ${niveau.toUpperCase().padEnd(5)} ${message}${suffixe}`);
}

export const logger = {
	info: (message: string, contexte?: Contexte) => emettre('info', message, contexte),
	warn: (message: string, contexte?: Contexte) => emettre('warn', message, contexte),
	error: (message: string, contexte?: Contexte) => emettre('error', message, contexte)
};
