<script lang="ts">
	import { enhance } from '$app/forms';
	import { depuis, formatDateTime } from '$lib/time';

	let { data, form } = $props();

	// Le mot est affiche a cote de la couleur : la gravite ne doit pas se lire
	// uniquement au vert/orange/rouge.
	const GRAVITE_MOT = { ok: 'ok', attention: 'attention', probleme: 'probleme' };
	const GRAVITE_CLASSE = {
		ok: 'badge--sain',
		attention: 'badge--attention',
		probleme: 'badge--probleme'
	};

	const groups = $derived.by(() => {
		const map = new Map<string, typeof data.settings>();
		for (const setting of data.settings) {
			if (!map.has(setting.group)) map.set(setting.group, []);
			map.get(setting.group)!.push(setting);
		}
		return [...map.entries()];
	});

	const seasonStarted = $derived(data.weeks.some((w) => w.status !== 'a_venir'));
</script>

<svelte:head><title>Admin — Pronos NFL</title></svelte:head>

<h1>Administration</h1>
<p class="small muted">
	Saison {data.season} · <a href="/admin/matchs">corriger un score →</a>
</p>

{#if form?.ok}
	<div class="alert alert--ok small">{form.ok}</div>
{/if}
{#if form?.error}
	<div class="alert alert--error small">{form.error}</div>
{/if}

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>
		Etat du systeme
		<span class="badge {GRAVITE_CLASSE[data.etat.gravite]}">{GRAVITE_MOT[data.etat.gravite]}</span>
	</h2>
	<p class="small muted">
		{data.etat.enSaison
			? 'En saison : les seuils de fraicheur sont actifs.'
			: 'Hors saison : l’absence de snapshot et de poll est normale, elle n’est pas signalee.'}
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Indicateur</th>
					<th>Etat</th>
					<th>Quand</th>
					<th>Detail</th>
				</tr>
			</thead>
			<tbody>
				{#each data.etat.indicateurs as indicateur (indicateur.cle)}
					<tr>
						<td>{indicateur.libelle}</td>
						<td>
							<span class="badge {GRAVITE_CLASSE[indicateur.gravite]}">
								{GRAVITE_MOT[indicateur.gravite]}
							</span>
						</td>
						<td title={indicateur.horodatage ? formatDateTime(indicateur.horodatage) : ''}>
							{depuis(indicateur.horodatage, data.etat.horodatage)}
						</td>
						<td class="small muted">{indicateur.detail}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if data.etat.erreursCron.length > 0}
		<h3 class="small" style="margin:1rem 0 0.4rem">Echecs non rattrapes</h3>
		<ul class="small">
			{#each data.etat.erreursCron as echec (echec.startedAt + echec.name)}
				<li>
					<strong>{echec.libelle}</strong> — {formatDateTime(echec.startedAt)}
					<div class="muted">{echec.message ?? 'sans message'}</div>
				</li>
			{/each}
		</ul>
		<p class="tiny muted">
			Une tache disparait de cette liste des qu'elle reussit a nouveau : ce qui reste ici n'a
			pas ete rattrape tout seul.
		</p>
	{/if}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Taches planifiees</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Tache</th>
					<th>Planification</th>
					<th>Prochaine</th>
					<th>Derniere execution</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.tasks as task (task.name)}
					<tr>
						<td>
							{task.label}
							{#if task.running}<span class="badge badge--live">en cours</span>{/if}
						</td>
						<td><code class="tiny">{task.pattern}</code></td>
						<td class="tiny">{task.nextRun ? formatDateTime(task.nextRun) : '—'}</td>
						<td class="tiny">
							{#if task.lastRun}
								<span
									class="badge"
									class:badge--open={task.lastRun.status === 'ok'}
									class:badge--live={task.lastRun.status === 'error'}
								>
									{task.lastRun.status}
								</span>
								{formatDateTime(task.lastRun.startedAt)}
								<div class="muted" style="white-space:normal;max-width:32ch">
									{task.lastRun.message ?? ''}
								</div>
							{:else}
								jamais
							{/if}
						</td>
						<td>
							<form method="POST" action="?/tache" use:enhance>
								<input type="hidden" name="name" value={task.name} />
								<button class="btn btn--sm" type="submit" disabled={task.running}>Relancer</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Actions manuelles</h2>
	<div class="stack">
		<form method="POST" action="?/snapshot" use:enhance class="row wrap">
			<span class="small muted">Snapshot des cotes</span>
			<input
				type="number"
				name="week"
				min="1"
				max="22"
				placeholder="semaine"
				style="width:6.5rem"
				aria-label="Numero de semaine"
			/>
			<select name="seasontype" aria-label="Type de saison" style="width:auto">
				<option value="2">Saison reguliere</option>
				<option value="3">Playoffs</option>
			</select>
			<label class="small muted row" style="gap:0.3rem">
				<input type="checkbox" name="force" style="width:auto" /> ecraser le bareme existant
			</label>
			<button class="btn" type="submit">Lancer</button>
		</form>
		<p class="tiny muted" style="margin:0">
			Sans numero, la semaine courante d'ESPN est utilisee. « Ecraser » recalcule un bareme deja
			fige : a n'utiliser qu'avant l'ouverture des pronostics.
		</p>

		<div class="row wrap">
			<form method="POST" action="?/recalcul" use:enhance>
				<button class="btn" type="submit">Recalculer tous les points</button>
			</form>
			<form method="POST" action="?/cloturer" use:enhance>
				<button class="btn" type="submit">Cloturer les semaines terminees</button>
			</form>
			<form method="POST" action="?/sauvegarde" use:enhance>
				<button class="btn" type="submit">Sauvegarder la base</button>
			</form>
		</div>
		<p class="tiny muted" style="margin:0">
			Le recalcul est idempotent : il reecrit les points a partir des pronostics et du bareme fige.
		</p>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Invitations</h2>
	<form method="POST" action="?/inviter" use:enhance class="row wrap" style="margin-bottom:0.9rem">
		<input
			type="email"
			name="email"
			placeholder="email (optionnel, rend le code nominatif)"
			style="flex:1;min-width:14rem;text-align:left"
			aria-label="Email de l'invite"
		/>
		<input
			type="text"
			name="note"
			placeholder="note"
			style="width:9rem;text-align:left"
			aria-label="Note"
		/>
		<input
			type="number"
			name="ttlDays"
			placeholder="jours"
			min="1"
			max="365"
			style="width:6rem"
			aria-label="Validite en jours"
		/>
		<button class="btn btn--primary" type="submit">Creer un code</button>
	</form>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Code</th>
					<th>Reserve a</th>
					<th>Statut</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.invites as invite (invite.id)}
					<tr>
						<td><code>{invite.code}</code></td>
						<td class="small muted">{invite.email ?? 'libre'}{invite.note ? ` · ${invite.note}` : ''}</td>
						<td class="small">
							{#if invite.usedAt}
								<span class="badge">utilise le {formatDateTime(invite.usedAt)}</span>
							{:else if invite.expiresAt && invite.expiresAt * 1000 < Date.now()}
								<span class="badge badge--locked">expire</span>
							{:else}
								<span class="badge badge--open">
									valide{invite.expiresAt ? ` jusqu'au ${formatDateTime(invite.expiresAt)}` : ''}
								</span>
							{/if}
						</td>
						<td>
							{#if !invite.usedAt}
								<form method="POST" action="?/supprimerInvite" use:enhance>
									<input type="hidden" name="id" value={invite.id} />
									<button class="btn btn--sm btn--danger" type="submit">Supprimer</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
				{#if data.invites.length === 0}
					<tr><td colspan="4" class="muted small">Aucune invitation.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Joueurs</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Pseudo</th>
					<th>Email</th>
					<th>Role</th>
					<th>Etat</th>
				</tr>
			</thead>
			<tbody>
				{#each data.players as player (player.id)}
					<tr>
						<td><a href="/joueur/{player.id}">{player.pseudo}</a></td>
						<td class="small muted">{player.email}</td>
						<td>
							<form method="POST" action="?/role" use:enhance class="row">
								<input type="hidden" name="id" value={player.id} />
								<input type="hidden" name="role" value={player.role === 'admin' ? 'joueur' : 'admin'} />
								<span class="badge">{player.role}</span>
								<button class="btn btn--sm" type="submit">
									{player.role === 'admin' ? 'retirer admin' : 'promouvoir'}
								</button>
							</form>
						</td>
						<td>
							<form method="POST" action="?/activer" use:enhance>
								<input type="hidden" name="id" value={player.id} />
								<button class="btn btn--sm" type="submit">
									{player.active === 1 ? 'desactiver' : 'reactiver'}
								</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Reglages du bareme</h2>
	{#if seasonStarted}
		<div class="alert alert--warn small">
			La saison a commence. Modifier une constante ne change pas les baremes deja figes ; relance le
			recalcul des points pour appliquer les nouvelles valeurs aux matchs deja joues.
		</div>
	{/if}

	{#each groups as [group, items] (group)}
		<h3 style="margin-top:1rem">{group}</h3>
		{#each items as setting (setting.key)}
			<form method="POST" action="?/reglage" use:enhance class="between wrap" style="padding:0.35rem 0">
				<label class="small grow" for="set-{setting.key}">
					{setting.label}
					<div class="tiny muted"><code>{setting.key}</code></div>
				</label>
				<input type="hidden" name="key" value={setting.key} />
				<input
					id="set-{setting.key}"
					type="number"
					name="value"
					value={setting.current}
					min={setting.min}
					max={setting.max}
					step={setting.step}
					style="width:7rem"
				/>
				<button class="btn btn--sm" type="submit">OK</button>
			</form>
		{/each}
	{/each}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Journal des taches</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Quand</th>
					<th>Tache</th>
					<th>Statut</th>
					<th>Message</th>
				</tr>
			</thead>
			<tbody>
				{#each data.runs as run (run.id)}
					<tr>
						<td class="tiny">{formatDateTime(run.startedAt)}</td>
						<td class="small">{run.name} <span class="tiny muted">({run.trigger})</span></td>
						<td>
							<span
								class="badge"
								class:badge--open={run.status === 'ok'}
								class:badge--live={run.status === 'error'}>{run.status}</span
							>
						</td>
						<td class="tiny muted" style="white-space:normal">{run.message ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
