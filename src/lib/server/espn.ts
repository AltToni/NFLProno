import { logger } from './logger';

/**
 * Client de l'API ESPN publique (sans cle). Deux sources sont utilisees :
 *
 *  1. `site.api.espn.com/.../scoreboard` : calendrier, statuts, scores et, tant
 *     que le match n'a pas commence, un tableau `odds[]`.
 *  2. `sports.core.api.espn.com/.../odds` : repli quand le scoreboard ne
 *     renvoie pas de cotes (c'est frequent : ESPN retire `odds[]` des que le
 *     match est termine, et parfois plusieurs jours avant le kickoff).
 *
 * Le client est defensif : timeouts, retries avec backoff, et tolerance
 * complete aux champs manquants. Aucun throw ne doit pouvoir venir d'un champ
 * absent, seulement d'une indisponibilite reseau.
 */

const SITE_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE_API = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/** Identifiant ESPN BET chez ESPN ; on le prefere a tout autre bookmaker. */
const PREFERRED_PROVIDER_IDS = ['58', '2000'];
const PREFERRED_PROVIDER_NAMES = ['espn bet', 'espn bet - live odds'];

export interface EspnTeam {
	id: string | null;
	abbreviation: string;
	displayName: string;
	logo: string | null;
}

export interface EspnOdds {
	provider: string | null;
	moneylineHome: number | null;
	moneylineAway: number | null;
	spread: number | null;
	overUnder: number | null;
	raw: unknown;
}

export interface EspnGame {
	id: string;
	kickoffUtc: number;
	status: 'scheduled' | 'in' | 'final' | 'postponed' | 'canceled';
	statusDetail: string | null;
	home: EspnTeam;
	away: EspnTeam;
	scoreHome: number | null;
	scoreAway: number | null;
	odds: EspnOdds | null;
}

export interface EspnScoreboard {
	season: number;
	seasontype: number;
	week: number;
	games: EspnGame[];
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface FetchOptions {
	retries?: number;
	timeoutMs?: number;
}

export async function fetchJson<T = any>(url: string, opts: FetchOptions = {}): Promise<T> {
	const retries = opts.retries ?? 3;
	const timeoutMs = opts.timeoutMs ?? 12_000;
	let lastError: unknown;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(timeoutMs),
				headers: {
					accept: 'application/json',
					'user-agent': 'nfl-pronos/1.0 (+auto-heberge, usage prive)'
				}
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
			return (await res.json()) as T;
		} catch (error) {
			lastError = error;
			if (attempt < retries) {
				const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
				logger.warn(
					`ESPN: echec (${(error as Error).message}), nouvelle tentative dans ${delay} ms`
				);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(String(value).replace('+', ''));
	return Number.isFinite(n) ? n : null;
}

/** Accepte 120, "-160", "+120", "EVEN". */
export function parseAmerican(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? value : null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^(even|ev|pk)$/i.test(trimmed)) return 100;
	const n = Number(trimmed.replace('+', ''));
	return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Extrait une moneyline d'un bloc `homeTeamOdds` / `awayTeamOdds`, tous formats. */
function teamMoneyline(teamOdds: any): number | null {
	if (!teamOdds || typeof teamOdds !== 'object') return null;
	const candidates = [
		teamOdds.moneyLine,
		teamOdds.moneyline,
		teamOdds.current?.moneyLine?.american,
		teamOdds.current?.moneyLine?.value,
		teamOdds.close?.moneyLine?.american,
		teamOdds.open?.moneyLine?.american
	];
	for (const candidate of candidates) {
		const parsed = parseAmerican(candidate);
		if (parsed !== null) return parsed;
	}
	return null;
}

function providerScore(item: any): number {
	const id = String(item?.provider?.id ?? '');
	const name = String(item?.provider?.name ?? '').toLowerCase();
	if (PREFERRED_PROVIDER_IDS.includes(id)) return 0;
	if (PREFERRED_PROVIDER_NAMES.some((n) => name.includes(n))) return 0;
	if (name.includes('espn')) return 1;
	return 2;
}

/**
 * Choisit la meilleure entree de cotes : ESPN BET en priorite, puis n'importe
 * quel bookmaker fournissant les deux moneylines.
 */
export function extractOdds(oddsArray: unknown): EspnOdds | null {
	if (!Array.isArray(oddsArray) || oddsArray.length === 0) return null;

	const usable = oddsArray
		.map((item) => ({
			item,
			home: teamMoneyline(item?.homeTeamOdds),
			away: teamMoneyline(item?.awayTeamOdds),
			rank: providerScore(item)
		}))
		.filter((c) => c.home !== null && c.away !== null)
		.sort((a, b) => a.rank - b.rank);

	const best = usable[0];
	if (!best) {
		// Pas de moneyline exploitable, mais on conserve spread / total si presents.
		const first: any = oddsArray[0];
		return {
			provider: first?.provider?.name ?? null,
			moneylineHome: null,
			moneylineAway: null,
			spread: num(first?.spread),
			overUnder: num(first?.overUnder),
			raw: oddsArray
		};
	}

	return {
		provider: best.item?.provider?.name ?? null,
		moneylineHome: best.home,
		moneylineAway: best.away,
		spread: num(best.item?.spread),
		overUnder: num(best.item?.overUnder),
		raw: oddsArray
	};
}

function parseTeam(competitor: any): EspnTeam {
	const team = competitor?.team ?? {};
	return {
		id: team.id ? String(team.id) : null,
		abbreviation: String(team.abbreviation ?? team.shortDisplayName ?? '???'),
		displayName: String(team.displayName ?? team.name ?? team.abbreviation ?? 'Equipe'),
		logo: team.logo ?? team.logos?.[0]?.href ?? null
	};
}

function parseStatus(status: any): { status: EspnGame['status']; detail: string | null } {
	const name = String(status?.type?.name ?? '').toUpperCase();
	const state = String(status?.type?.state ?? '').toLowerCase();
	const detail = status?.type?.detail ?? status?.type?.shortDetail ?? null;

	if (name.includes('POSTPONED') || name.includes('DELAYED')) return { status: 'postponed', detail };
	if (name.includes('CANCEL') || name.includes('FORFEIT')) return { status: 'canceled', detail };
	if (state === 'post' || status?.type?.completed === true) return { status: 'final', detail };
	if (state === 'in') return { status: 'in', detail };
	return { status: 'scheduled', detail };
}

export function parseScoreboard(payload: any): EspnScoreboard {
	const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
	const games: EspnGame[] = [];

	for (const event of events) {
		const competition = event?.competitions?.[0];
		if (!competition) continue;

		const competitors: any[] = Array.isArray(competition.competitors) ? competition.competitors : [];
		const homeC = competitors.find((c) => c?.homeAway === 'home');
		const awayC = competitors.find((c) => c?.homeAway === 'away');
		if (!homeC || !awayC) continue;

		const dateStr = competition.date ?? event.date;
		const kickoff = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : NaN;
		if (!Number.isFinite(kickoff)) continue;

		const { status, detail } = parseStatus(competition.status ?? event.status);

		games.push({
			id: String(event.id),
			kickoffUtc: kickoff,
			status,
			statusDetail: detail,
			home: parseTeam(homeC),
			away: parseTeam(awayC),
			scoreHome: num(homeC.score),
			scoreAway: num(awayC.score),
			odds: extractOdds(competition.odds)
		});
	}

	return {
		season: Number(payload?.season?.year ?? payload?.leagues?.[0]?.season?.year ?? 0),
		seasontype: Number(payload?.season?.type ?? payload?.leagues?.[0]?.season?.type?.type ?? 2),
		week: Number(payload?.week?.number ?? 0),
		games
	};
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export async function getScoreboard(
	year: number,
	seasontype: number,
	week: number
): Promise<{ parsed: EspnScoreboard; raw: unknown }> {
	const url = `${SITE_API}/scoreboard?week=${week}&seasontype=${seasontype}&year=${year}&limit=400`;
	const raw = await fetchJson(url);
	return { parsed: parseScoreboard(raw), raw };
}

/** Semaine courante selon ESPN (le scoreboard sans parametre la renvoie). */
export async function getCurrentPeriod(): Promise<{
	season: number;
	seasontype: number;
	week: number;
}> {
	const raw = await fetchJson<any>(`${SITE_API}/scoreboard`);
	const parsed = parseScoreboard(raw);
	return { season: parsed.season, seasontype: parsed.seasontype, week: parsed.week };
}

/**
 * Repli sur la core API quand le scoreboard n'expose pas de cotes.
 * Renvoie null (jamais d'exception) si rien n'est exploitable.
 */
export async function getEventOdds(eventId: string): Promise<EspnOdds | null> {
	try {
		const url = `${CORE_API}/events/${eventId}/competitions/${eventId}/odds`;
		const payload = await fetchJson<any>(url, { retries: 1, timeoutMs: 8000 });
		const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
		if (items.length === 0) return null;
		return extractOdds(items);
	} catch (error) {
		logger.warn(`ESPN: cotes indisponibles pour l'evenement ${eventId} (${(error as Error).message})`);
		return null;
	}
}

/** Cotes du scoreboard, completees si besoin par la core API, match par match. */
export async function enrichOdds(games: EspnGame[]): Promise<EspnGame[]> {
	const enriched: EspnGame[] = [];
	for (const game of games) {
		if (game.odds?.moneylineHome != null && game.odds?.moneylineAway != null) {
			enriched.push(game);
			continue;
		}
		const fallback = await getEventOdds(game.id);
		enriched.push(fallback ? { ...game, odds: fallback } : game);
	}
	return enriched;
}
