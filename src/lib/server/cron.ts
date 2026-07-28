import { Cron } from 'croner';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { cronRuns, games, users, weeks } from './db/schema';
import { runSnapshot, syncScores } from './sync';
import { computePendingScores, computeWeekScores } from './results';
import { weekWinner } from './standings';
import { backupDatabase } from './backup';
import { missingPicksByUser } from './picks';
import { currentWeek } from './weeks';
import { currentSeason, getSetting } from './settings';
import { reminderEmail, sendMail } from './mail';
import { createLoginToken, magicLinkUrl, purgeExpired } from './auth';
import { ignoreLeKickoff } from '$lib/nfl';
import { APP_TIMEZONE, now } from '$lib/time';
import { logger } from './logger';

export type TaskName = 'snapshot' | 'results' | 'close' | 'backup' | 'reminder';

export const TASK_LABELS: Record<TaskName, string> = {
	snapshot: 'Snapshot des cotes (mercredi 09:00)',
	results: 'Poll des scores (toutes les 15 min, jeu-lun)',
	close: 'Cloture de la semaine (mardi 09:00)',
	backup: 'Sauvegarde de la base (quotidienne)',
	reminder: 'Rappel de pronostics (jeudi matin)'
};

const DEFAULT_PATTERNS: Record<TaskName, string> = {
	snapshot: '0 9 * * 3',
	// croner : 0 = dimanche. Jeudi a lundi couvre toute la fenetre de matchs.
	results: '*/15 * * * 0,1,4,5,6',
	close: '0 9 * * 2',
	backup: '30 4 * * *',
	reminder: '0 8 * * 4'
};

function pattern(name: TaskName): string {
	const env = process.env[`CRON_${name.toUpperCase()}`];
	return env && env.trim() ? env.trim() : DEFAULT_PATTERNS[name];
}

const jobs = new Map<TaskName, Cron>();
const running = new Set<TaskName>();

/** Enveloppe d'execution : journalise debut, fin et erreur dans `cron_runs`. */
export async function runTask(
	name: TaskName,
	trigger: 'cron' | 'manuel' = 'cron'
): Promise<{ ok: boolean; message: string }> {
	if (running.has(name)) {
		return { ok: false, message: 'Tache deja en cours.' };
	}
	running.add(name);

	const startedAt = now();
	const runId = db
		.insert(cronRuns)
		.values({ name, startedAt, status: 'running', trigger })
		.returning({ id: cronRuns.id })
		.get()?.id;

	try {
		const message = await TASKS[name]();
		if (runId) {
			db.update(cronRuns)
				.set({ finishedAt: now(), status: 'ok', message })
				.where(eq(cronRuns.id, runId))
				.run();
		}
		logger.info(`Tache ${name} (${trigger}) : ${message}`);
		return { ok: true, message };
	} catch (error) {
		const message = (error as Error).message ?? String(error);
		if (runId) {
			db.update(cronRuns)
				.set({ finishedAt: now(), status: 'error', message })
				.where(eq(cronRuns.id, runId))
				.run();
		}
		logger.error(`Tache ${name} (${trigger}) en echec : ${message}`);
		return { ok: false, message };
	} finally {
		running.delete(name);
	}
}

// ---------------------------------------------------------------------------
// Implementation des taches
// ---------------------------------------------------------------------------

const TASKS: Record<TaskName, () => Promise<string>> = {
	async snapshot() {
		const result = await runSnapshot();
		purgeExpired();
		return (
			`${result.weekLabel} : ${result.gamesUpserted} matchs, ` +
			`${result.snapshotsCreated} baremes figes, ${result.snapshotsSkipped} conserves` +
			(result.fallbacks.length ? `, repli sur ${result.fallbacks.length} match(s)` : '')
		);
	},

	async results() {
		const sync = await syncScores();
		const report = computePendingScores();
		return (
			`${sync.games} match(s) rafraichi(s), ${report.gamesScored} match(s) score(s), ` +
			`${report.picksScored} pronostic(s) calcule(s)`
		);
	},

	async close() {
		return closeFinishedWeeks();
	},

	async backup() {
		const result = backupDatabase();
		return `${result.file} (${Math.round(result.bytes / 1024)} Ko)`;
	},

	async reminder() {
		if (getSetting('mail.reminder_enabled') !== 1) return 'Rappels desactives dans les reglages.';
		const week = currentWeek();
		if (!week || week.status !== 'ouverte') return 'Aucune semaine ouverte.';

		const rows = missingPicksByUser(week.id).filter((r) => r.missing > 0);
		let sent = 0;
		for (const row of rows) {
			const token = createLoginToken(row.userId);
			const url = magicLinkUrl(token, process.env.PUBLIC_BASE_URL ?? '');
			const mail = reminderEmail(row.pseudo, week.label, row.missing, url);
			const res = await sendMail({ ...mail, to: row.email });
			if (res.sent) sent++;
		}
		return `${sent} rappel(s) envoye(s) sur ${rows.length} joueur(s) concerne(s)`;
	}
};

/**
 * Cloture des semaines dont tous les matchs sont joues : fige le classement
 * hebdomadaire et designe le vainqueur de la semaine.
 */
export function closeFinishedWeeks(): string {
	const season = currentSeason();
	const open = db
		.select()
		.from(weeks)
		.where(and(eq(weeks.season, season), eq(weeks.status, 'ouverte')))
		.all();

	const closed: string[] = [];

	for (const week of open) {
		// Une semaine de rejeu n'a que des matchs deja finals : la cloture
		// automatique la fermerait des le premier passage, donc avant que
		// quiconque ait pu y saisir un pronostic. Elle se ferme a la purge.
		if (ignoreLeKickoff(week.testKind)) continue;

		const weekGames = db.select().from(games).where(eq(games.weekId, week.id)).all();
		if (weekGames.length === 0) continue;

		const pending = weekGames.filter((game) => {
			if (game.status === 'final' || game.neutralized === 1) return false;
			// Tolerance : un match dont le kickoff date de plus de 8 h sans statut
			// final ne doit pas bloquer la cloture indefiniment.
			return now() - game.kickoffUtc < 8 * 3600;
		});
		if (pending.length > 0) continue;

		computeWeekScores(week.id);
		const winner = weekWinner(week.id);
		const winnerName = winner
			? db.select({ pseudo: users.pseudo }).from(users).where(eq(users.id, winner.userId)).get()
					?.pseudo
			: null;

		db.update(weeks)
			.set({ status: 'cloturee', closedAt: now(), winnerUserId: winner?.userId ?? null })
			.where(eq(weeks.id, week.id))
			.run();

		closed.push(
			`${week.label}${winnerName ? ` (vainqueur : ${winnerName}, ${winner!.points} pts)` : ' (ex aequo)'}`
		);
	}

	return closed.length ? `Cloture : ${closed.join(', ')}` : 'Aucune semaine a cloturer.';
}

// ---------------------------------------------------------------------------
// Ordonnanceur
// ---------------------------------------------------------------------------

let started = false;

export function startCron(): void {
	if (started) return;
	if (process.env.CRON_ENABLED === '0') {
		logger.warn('Ordonnanceur desactive (CRON_ENABLED=0)');
		started = true;
		return;
	}
	started = true;

	for (const name of Object.keys(DEFAULT_PATTERNS) as TaskName[]) {
		const job = new Cron(
			pattern(name),
			{ timezone: process.env.TZ || APP_TIMEZONE, protect: true, name },
			() => {
				void runTask(name, 'cron');
			}
		);
		jobs.set(name, job);
		logger.info(`Cron ${name} programme : ${pattern(name)} (${process.env.TZ || APP_TIMEZONE})`);
	}
}

export interface TaskStatus {
	name: TaskName;
	label: string;
	pattern: string;
	nextRun: number | null;
	running: boolean;
	lastRun: {
		startedAt: number;
		finishedAt: number | null;
		status: string;
		message: string | null;
		trigger: string;
	} | null;
}

export function taskStatuses(): TaskStatus[] {
	return (Object.keys(DEFAULT_PATTERNS) as TaskName[]).map((name) => {
		const last = db
			.select()
			.from(cronRuns)
			.where(eq(cronRuns.name, name))
			.orderBy(desc(cronRuns.startedAt))
			.get();
		const next = jobs.get(name)?.nextRun() ?? null;
		return {
			name,
			label: TASK_LABELS[name],
			pattern: pattern(name),
			nextRun: next ? Math.floor(next.getTime() / 1000) : null,
			running: running.has(name),
			lastRun: last
				? {
						startedAt: last.startedAt,
						finishedAt: last.finishedAt,
						status: last.status,
						message: last.message,
						trigger: last.trigger
					}
				: null
		};
	});
}

export function recentRuns(limit = 40) {
	return db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(limit).all();
}
