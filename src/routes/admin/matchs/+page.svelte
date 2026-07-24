<script lang="ts">
	import { enhance } from '$app/forms';
	import LocalTime from '$lib/components/LocalTime.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Correction des matchs — Admin</title></svelte:head>

<p class="small muted"><a href="/admin">← Administration</a></p>
<h1>Correction manuelle des scores</h1>

{#if form?.ok}<div class="alert alert--ok small">{form.ok}</div>{/if}
{#if form?.error}<div class="alert alert--error small">{form.error}</div>{/if}

<div class="tabs">
	{#each data.weeks as week (week.id)}
		<a class="tab" class:tab--active={week.id === data.week?.id} href="/admin/matchs?semaine={week.id}"
			>{week.label}</a
		>
	{/each}
</div>

{#if !data.week}
	<div class="card muted">Aucune semaine en base. Lance d'abord un snapshot.</div>
{:else}
	<p class="tiny muted">
		Une correction fige le match : le poll ESPN ne l'ecrasera plus tant que la synchronisation n'est
		pas retablie. Les points du match sont recalcules immediatement.
	</p>

	{#each data.games as game (game.id)}
		<div class="card">
			<div class="between wrap">
				<strong>{game.awayAbbr} @ {game.homeAbbr}</strong>
				<span class="small muted">
					<LocalTime value={game.kickoffUtc} withDate />
					{#if game.manualOverride === 1}
						<span class="badge badge--locked">corrige a la main</span>
					{/if}
				</span>
			</div>

			<form method="POST" action="?/corriger" use:enhance class="row wrap" style="margin-top:0.6rem">
				<input type="hidden" name="gameId" value={game.id} />

				<label class="tiny muted" for="a-{game.id}">{game.awayAbbr}</label>
				<input
					id="a-{game.id}"
					type="number"
					name="scoreAway"
					min="0"
					max="199"
					value={game.scoreAway ?? ''}
					style="width:5rem"
				/>

				<label class="tiny muted" for="h-{game.id}">{game.homeAbbr}</label>
				<input
					id="h-{game.id}"
					type="number"
					name="scoreHome"
					min="0"
					max="199"
					value={game.scoreHome ?? ''}
					style="width:5rem"
				/>

				<select name="status" style="width:auto" aria-label="Statut">
					<option value="scheduled" selected={game.status === 'scheduled'}>a venir</option>
					<option value="in" selected={game.status === 'in'}>en cours</option>
					<option value="final" selected={game.status === 'final'}>termine</option>
					<option value="postponed" selected={game.status === 'postponed'}>reporte</option>
					<option value="canceled" selected={game.status === 'canceled'}>annule</option>
				</select>

				<label class="tiny muted row" style="gap:0.3rem">
					<input
						type="checkbox"
						name="neutralized"
						checked={game.neutralized === 1}
						style="width:auto"
					/>
					neutraliser
				</label>

				<button class="btn btn--sm btn--primary" type="submit">Enregistrer</button>
			</form>

			{#if game.manualOverride === 1}
				<form method="POST" action="?/auto" use:enhance style="margin-top:0.5rem">
					<input type="hidden" name="gameId" value={game.id} />
					<button class="btn btn--sm" type="submit">Retablir la synchronisation ESPN</button>
				</form>
			{/if}
		</div>
	{/each}
{/if}
