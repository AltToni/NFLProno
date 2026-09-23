import { sqlite } from './db';
import { currentSeason, leagueName } from './settings';
import { now } from '$lib/time';

/**
 * Export lisible de la saison, telechargeable depuis l'admin.
 *
 * Ce n'est **pas** une sauvegarde : rien ici ne se restaure. C'est l'archive
 * qu'on garde une fois la saison finie, ou qu'on ouvre dans un tableur pour
 * regarder les chiffres autrement que par les ecrans du jeu. La sauvegarde
 * restaurable, c'est le fichier `.db` (cf. `backup.ts`).
 */

interface Ligne {
	[colonne: string]: string | number | null;
}

function lignes(sql: string, params: Record<string, unknown> = {}): Ligne[] {
	return sqlite.prepare(sql).all(params) as Ligne[];
}

const JOUEURS = `
	SELECT id, pseudo, email, role, active, created_at AS createdAt
	FROM users ORDER BY pseudo COLLATE NOCASE
`;

const SEMAINES = `
	SELECT id, season, seasontype, number, label, status, test_kind AS testKind,
		closed_at AS closedAt, winner_user_id AS winnerUserId
	FROM weeks WHERE season = @season ORDER BY seasontype, number
`;

const MATCHS = `
	SELECT g.id, g.week_id AS weekId, w.label AS weekLabel,
		g.away_abbr AS awayAbbr, g.home_abbr AS homeAbbr,
		g.kickoff_utc AS kickoffUtc, g.status,
		g.score_away AS scoreAway, g.score_home AS scoreHome, g.neutralized,
		o.p_home AS pHome, o.p_away AS pAway,
		o.base_points_home AS basePointsHome, o.base_points_away AS basePointsAway
	FROM games g
	JOIN weeks w ON w.id = g.week_id
	LEFT JOIN odds_snapshots o ON o.game_id = g.id
	WHERE w.season = @season
	ORDER BY w.seasontype, w.number, g.kickoff_utc
`;

/** Une ligne par pronostic, avec les points qu'il a rapportes. */
const PRONOSTICS = `
	SELECT w.label AS weekLabel, u.pseudo,
		g.id AS gameId, g.away_abbr AS awayAbbr, g.home_abbr AS homeAbbr,
		g.score_away AS scoreAway, g.score_home AS scoreHome, g.status,
		p.pick_side AS pickSide, p.margin_pred AS marginPred,
		s.points, s.base_points AS basePoints, s.bonus_points AS bonusPoints,
		s.bonus_kind AS bonusKind, s.correct, s.exact_margin AS exactMargin
	FROM picks p
	JOIN users u ON u.id = p.user_id
	JOIN games g ON g.id = p.game_id
	JOIN weeks w ON w.id = g.week_id
	LEFT JOIN scores s ON s.game_id = p.game_id AND s.user_id = p.user_id
	WHERE w.season = @season
	ORDER BY w.seasontype, w.number, u.pseudo COLLATE NOCASE, g.kickoff_utc
`;

const AJUSTEMENTS = `
	SELECT w.label AS weekLabel, u.pseudo, a.points, a.reason,
		a.created_at AS createdAt,
		(SELECT pseudo FROM users WHERE id = a.created_by) AS createdBy
	FROM score_adjustments a
	JOIN users u ON u.id = a.user_id
	JOIN weeks w ON w.id = a.week_id
	WHERE w.season = @season
	ORDER BY w.seasontype, w.number, u.pseudo COLLATE NOCASE
`;

export function exportJson(season = currentSeason()): string {
	const params = { season };
	return JSON.stringify(
		{
			ligue: leagueName(),
			saison: season,
			genereLe: now(),
			joueurs: lignes(JOUEURS),
			semaines: lignes(SEMAINES, params),
			matchs: lignes(MATCHS, params),
			pronostics: lignes(PRONOSTICS, params),
			ajustements: lignes(AJUSTEMENTS, params)
		},
		null,
		2
	);
}

/**
 * Echappement CSV. Le separateur est le point-virgule et non la virgule :
 * c'est ce qu'attend un tableur configure en francais, et le fichier s'ouvre
 * alors d'un double-clic au lieu de tomber dans un assistant d'import.
 */
function cellule(valeur: string | number | null | undefined): string {
	if (valeur === null || valeur === undefined) return '';
	const texte = String(valeur);
	return /[";\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

const EN_TETES = [
	'type',
	'semaine',
	'joueur',
	'match',
	'resultat',
	'pronostic',
	'ecart annonce',
	'ecart reel',
	'points',
	'dont base',
	'dont bonus',
	'nature du bonus',
	'vainqueur trouve',
	'ecart exact',
	'motif'
];

/**
 * Un CSV a plat, une ligne par pronostic. Les ajustements y figurent aussi,
 * avec `type = ajustement` et un match vide : sommer la colonne « points » d'un
 * joueur doit redonner son total au classement, ce qui ne serait pas vrai si
 * les corrections manquaient.
 */
export function exportCsv(season = currentSeason()): string {
	const lignesCsv: string[] = [EN_TETES.join(';')];

	for (const p of lignes(PRONOSTICS, { season })) {
		const cote = p.pickSide === 'home' ? p.homeAbbr : p.pickSide === 'away' ? p.awayAbbr : 'nul';
		const finie = p.status === 'final' && p.scoreHome !== null && p.scoreAway !== null;
		lignesCsv.push(
			[
				'pronostic',
				p.weekLabel,
				p.pseudo,
				`${p.awayAbbr} @ ${p.homeAbbr}`,
				finie ? `${p.scoreAway}-${p.scoreHome}` : p.status,
				cote,
				p.marginPred,
				finie ? Math.abs(Number(p.scoreHome) - Number(p.scoreAway)) : '',
				p.points,
				p.basePoints,
				p.bonusPoints,
				p.bonusKind,
				p.correct === 1 ? 'oui' : p.correct === 0 ? 'non' : '',
				p.exactMargin === 1 ? 'oui' : p.exactMargin === 0 ? 'non' : '',
				''
			]
				.map(cellule)
				.join(';')
		);
	}

	for (const a of lignes(AJUSTEMENTS, { season })) {
		lignesCsv.push(
			['ajustement', a.weekLabel, a.pseudo, '', '', '', '', '', a.points, '', '', '', '', '', a.reason]
				.map(cellule)
				.join(';')
		);
	}

	// BOM : sans lui, un tableur lit les accents de « Presaison » en mojibake.
	return `﻿${lignesCsv.join('\r\n')}\r\n`;
}
