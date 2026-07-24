import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { invites, users } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { createInvite } from '$lib/server/auth';
import { listSettings, setSetting, currentSeason, type SettingKey } from '$lib/server/settings';
import { recentRuns, runTask, taskStatuses, closeFinishedWeeks, type TaskName } from '$lib/server/cron';
import { runSnapshot } from '$lib/server/sync';
import { recomputeSeason } from '$lib/server/results';
import { backupDatabase } from '$lib/server/backup';
import { listWeeks } from '$lib/server/weeks';
import { etatSysteme } from '$lib/server/health';

export const load: PageServerLoad = async () => {
	return {
		invites: db
			.select({
				id: invites.id,
				code: invites.code,
				email: invites.email,
				note: invites.note,
				expiresAt: invites.expiresAt,
				usedBy: invites.usedBy,
				usedAt: invites.usedAt,
				createdAt: invites.createdAt
			})
			.from(invites)
			.orderBy(desc(invites.createdAt))
			.all(),
		players: db.select().from(users).orderBy(users.pseudo).all(),
		settings: listSettings(),
		tasks: taskStatuses(),
		runs: recentRuns(20),
		weeks: listWeeks(),
		season: currentSeason(),
		etat: etatSysteme()
	};
};

export const actions: Actions = {
	inviter: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const ttl = Number(form.get('ttlDays'));

		const invite = createInvite({
			email: email || null,
			note: note || null,
			ttlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
			createdBy: admin.id
		});

		return { ok: `Invitation creee : ${invite.code}` };
	},

	supprimerInvite: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const invite = db.select().from(invites).where(eq(invites.id, id)).get();
		if (!invite) return fail(404, { error: 'Invitation introuvable.' });
		if (invite.usedBy) return fail(400, { error: 'Cette invitation a deja ete utilisee.' });
		db.delete(invites).where(eq(invites.id, id)).run();
		return { ok: 'Invitation supprimee.' };
	},

	role: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const role = String(form.get('role'));
		if (role !== 'admin' && role !== 'joueur') return fail(400, { error: 'Role invalide.' });
		if (id === admin.id && role !== 'admin') {
			return fail(400, { error: 'Impossible de retirer ton propre role admin.' });
		}
		db.update(users).set({ role }).where(eq(users.id, id)).run();
		return { ok: 'Role mis a jour.' };
	},

	activer: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (id === admin.id) return fail(400, { error: 'Impossible de te desactiver toi-meme.' });
		const player = db.select().from(users).where(eq(users.id, id)).get();
		if (!player) return fail(404, { error: 'Joueur introuvable.' });
		db.update(users).set({ active: player.active === 1 ? 0 : 1 }).where(eq(users.id, id)).run();
		return { ok: `${player.pseudo} ${player.active === 1 ? 'desactive' : 'reactive'}.` };
	},

	reglage: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const key = String(form.get('key')) as SettingKey;
		const value = Number(form.get('value'));
		try {
			setSetting(key, value);
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
		return { ok: `Reglage ${key} mis a jour. Pense a relancer le recalcul si la saison a commence.` };
	},

	snapshot: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const week = Number(form.get('week'));
		const seasontype = Number(form.get('seasontype'));
		const force = form.get('force') === 'on';

		try {
			const result = await runSnapshot({
				week: Number.isFinite(week) && week > 0 ? week : undefined,
				seasontype: Number.isFinite(seasontype) && seasontype > 0 ? seasontype : undefined,
				force
			});
			return {
				ok:
					`${result.weekLabel} : ${result.gamesUpserted} matchs, ${result.snapshotsCreated} baremes ` +
					`ecrits, ${result.snapshotsSkipped} conserves` +
					(result.fallbacks.length ? `, repli sur : ${result.fallbacks.join(', ')}` : '')
			};
		} catch (err) {
			return fail(500, { error: (err as Error).message });
		}
	},

	recalcul: async ({ locals }) => {
		requireAdmin(locals);
		const report = recomputeSeason();
		return {
			ok:
				`Recalcul termine : ${report.gamesScored} match(s), ${report.picksScored} pronostic(s), ` +
				`${report.gamesNeutralized} neutralise(s)` +
				(report.missingSnapshots.length
					? ` — bareme manquant sur : ${report.missingSnapshots.join(', ')}`
					: '')
		};
	},

	cloturer: async ({ locals }) => {
		requireAdmin(locals);
		return { ok: closeFinishedWeeks() };
	},

	sauvegarde: async ({ locals }) => {
		requireAdmin(locals);
		try {
			const result = backupDatabase();
			return { ok: `Sauvegarde : ${result.file} (${Math.round(result.bytes / 1024)} Ko)` };
		} catch (err) {
			return fail(500, { error: (err as Error).message });
		}
	},

	tache: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const name = String(form.get('name')) as TaskName;
		const result = await runTask(name, 'manuel');
		return result.ok ? { ok: `${name} : ${result.message}` } : fail(500, { error: result.message });
	}
};
