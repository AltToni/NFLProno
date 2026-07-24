export const APP_TIMEZONE = 'Europe/Brussels';

/** Secondes epoch UTC. Toute la base est stockee dans cette unite. */
export function now(): number {
	return Math.floor(Date.now() / 1000);
}

export function toDate(epochSeconds: number): Date {
	return new Date(epochSeconds * 1000);
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = [
	'janvier',
	'fevrier',
	'mars',
	'avril',
	'mai',
	'juin',
	'juillet',
	'aout',
	'septembre',
	'octobre',
	'novembre',
	'decembre'
];

/**
 * Formatage belge (jj/mm/aaaa) dans un fuseau donne. Sur le serveur on passe
 * Europe/Brussels ; cote navigateur on laisse `undefined` pour que le joueur
 * voie l'heure de son propre fuseau (spec 7).
 */
export function formatDateTime(epochSeconds: number, timeZone?: string): string {
	return new Intl.DateTimeFormat('fr-BE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone
	}).format(toDate(epochSeconds));
}

export function formatTime(epochSeconds: number, timeZone?: string): string {
	return new Intl.DateTimeFormat('fr-BE', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone
	}).format(toDate(epochSeconds));
}

export function formatDate(epochSeconds: number, timeZone?: string): string {
	return new Intl.DateTimeFormat('fr-BE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone
	}).format(toDate(epochSeconds));
}

/** Ex. « jeudi 10 septembre ». Utilise pour les entetes de groupe de matchs. */
export function formatDayHeading(epochSeconds: number, timeZone = APP_TIMEZONE): string {
	const parts = new Intl.DateTimeFormat('fr-BE', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone
	}).formatToParts(toDate(epochSeconds));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const weekday = get('weekday') || JOURS[toDate(epochSeconds).getUTCDay()];
	const month = get('month') || MOIS[toDate(epochSeconds).getUTCMonth()];
	return `${weekday} ${get('day')} ${month}`;
}

/** Cle de regroupement par jour calendaire dans un fuseau donne. */
export function dayKey(epochSeconds: number, timeZone = APP_TIMEZONE): string {
	return new Intl.DateTimeFormat('en-CA', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone
	}).format(toDate(epochSeconds));
}

export function formatCountdown(seconds: number): string {
	if (seconds <= 0) return 'verrouille';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d > 0) return `${d} j ${h} h`;
	if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
	if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
	return `${s} s`;
}
