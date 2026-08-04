import { sqlite } from './db';
import { currentSeason, leagueName } from './settings';

/**
 * Donnees de la page d'accueil.
 *
 * Trois blocs, trois requetes, aucune logique de calcul : tout ce qui compte
 * des points est deja fige dans `scores` par `results.ts`. Ce module ne fait
 * que lire et mettre en forme.
 */

// ---------------------------------------------------------------------------
// Activite recente
// ---------------------------------------------------------------------------

export interface ActivityEntry {
	userId: number;
	pseudo: string;
	avatar: string | null;
	gameId: string;
	homeAbbr: string;
	awayAbbr: string;
	updatedAt: number;
	/**
	 * `true` / `false` une fois le match termine et les points calcules, `null`
	 * tant qu'il ne l'est pas.
	 *
	 * C'est la **seule** information que ce flux donne sur le contenu d'un
	 * pronostic, et elle n'arrive qu'apres coup. Avant le kickoff on annonce
	 * qu'un joueur a pronostique, jamais ce qu'il a joue : le devoiler
	 * reviendrait a distribuer les reponses avant l'heure, ce que `gameDetail`
	 * interdit deja sur la page match.
	 */
	correct: boolean | null;
}

export function recentActivity(limit = 8): ActivityEntry[] {
	return sqlite
		.prepare(
			`SELECT u.id AS userId, u.pseudo, u.avatar,
				g.id AS gameId, g.home_abbr AS homeAbbr, g.away_abbr AS awayAbbr,
				p.updated_at AS updatedAt,
				CASE WHEN g.status = 'final' AND s.id IS NOT NULL THEN s.correct ELSE NULL END AS correct
			 FROM picks p
			 JOIN users u ON u.id = p.user_id AND u.active = 1
			 JOIN games g ON g.id = p.game_id
			 JOIN weeks w ON w.id = g.week_id
			 LEFT JOIN scores s ON s.game_id = p.game_id AND s.user_id = p.user_id
			 WHERE w.season = @season
			 ORDER BY p.updated_at DESC
			 LIMIT @limit`
		)
		.all({ season: currentSeason(), limit })
		.map((r: any) => ({ ...r, correct: r.correct === null ? null : r.correct === 1 }));
}

// ---------------------------------------------------------------------------
// Derniers resultats
// ---------------------------------------------------------------------------

export interface ResultEntry {
	gameId: string;
	weekId: number;
	weekLabel: string;
	homeAbbr: string;
	homeLogo: string | null;
	awayAbbr: string;
	awayLogo: string | null;
	scoreHome: number;
	scoreAway: number;
	kickoffUtc: number;
	/** Bons pronostics de la ligue sur ce match, sur le nombre de joueurs ayant joue. */
	corrects: number;
	joues: number;
}

export function latestResults(limit = 4): ResultEntry[] {
	return sqlite
		.prepare(
			`SELECT g.id AS gameId, g.week_id AS weekId, w.label AS weekLabel,
				g.home_abbr AS homeAbbr, g.home_logo AS homeLogo,
				g.away_abbr AS awayAbbr, g.away_logo AS awayLogo,
				g.score_home AS scoreHome, g.score_away AS scoreAway, g.kickoff_utc AS kickoffUtc,
				COALESCE(SUM(s.correct), 0) AS corrects,
				COUNT(s.id) AS joues
			 FROM games g
			 JOIN weeks w ON w.id = g.week_id
			 LEFT JOIN scores s ON s.game_id = g.id
			 WHERE w.season = @season AND g.status = 'final' AND g.neutralized = 0
				   AND g.score_home IS NOT NULL AND g.score_away IS NOT NULL
			 GROUP BY g.id
			 ORDER BY g.kickoff_utc DESC
			 LIMIT @limit`
		)
		.all({ season: currentSeason(), limit }) as ResultEntry[];
}

// ---------------------------------------------------------------------------
// Ma ligue
// ---------------------------------------------------------------------------

export interface LeagueInfo {
	name: string;
	members: number;
}

/**
 * Le jeu n'a qu'une ligue : tous les comptes actifs en font partie. Cette
 * carte est donc purement informative — un nom, un compte de membres — et il
 * n'y a rien a rejoindre ni a quitter.
 */
export function leagueInfo(): LeagueInfo {
	const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM users WHERE active = 1`).get() as {
		n: number;
	};
	return { name: leagueName(), members: row.n };
}

// ---------------------------------------------------------------------------
// Recap du joueur
// ---------------------------------------------------------------------------

export interface Recap {
	weekPoints: number;
	seasonPoints: number;
	corrects: number;
	wrongs: number;
	played: number;
	successRate: number;
}

/**
 * Le bloc « Mon recap ». `played` compte les matchs **scores**, donc termines :
 * bons + mauvais font toujours le total, et le taux ne se dilue pas avec des
 * matchs encore a venir.
 */
export function recap(userId: number, weekId: number | null): Recap {
	const season = currentSeason();

	const saison = sqlite
		.prepare(
			`SELECT COALESCE(SUM(s.points), 0) AS points,
				COUNT(s.id) AS played,
				COALESCE(SUM(s.correct), 0) AS corrects
			 FROM scores s
			 JOIN weeks w ON w.id = s.week_id
			 WHERE s.user_id = @userId AND w.season = @season AND w.test_kind IS NULL`
		)
		.get({ userId, season }) as { points: number; played: number; corrects: number };

	// La semaine affichee peut etre une semaine de test : ses points ont leur
	// place dans le recap de la semaine, jamais dans le cumul de saison.
	const semaine = weekId
		? (sqlite
				.prepare(
					`SELECT COALESCE(SUM(points), 0) AS points FROM scores
					 WHERE user_id = @userId AND week_id = @weekId`
				)
				.get({ userId, weekId }) as { points: number })
		: { points: 0 };

	return {
		weekPoints: semaine.points,
		seasonPoints: saison.points,
		corrects: saison.corrects,
		wrongs: saison.played - saison.corrects,
		played: saison.played,
		successRate: saison.played > 0 ? saison.corrects / saison.played : 0
	};
}
