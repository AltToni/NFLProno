<script lang="ts">
	import RankChart from '$lib/components/RankChart.svelte';
	import { isTestWeek } from '$lib/nfl';

	let { data } = $props();

	let view = $state<'general' | 'semaine'>('general');

	const me = $derived(data.user?.id ?? null);
	const rows = $derived(view === 'general' ? data.season : data.weekly);
	const semaineDeTest = $derived(isTestWeek(data.week?.testKind));

	function percent(value: number): string {
		return `${Math.round(value * 100)} %`;
	}
</script>

<svelte:head><title>Classement — Pronos NFL</title></svelte:head>

<h1>Classement</h1>

<div class="tabs">
	<button class="tab" class:tab--active={view === 'general'} onclick={() => (view = 'general')}>
		General (saison)
	</button>
	<button class="tab" class:tab--active={view === 'semaine'} onclick={() => (view = 'semaine')}>
		{data.week?.label ?? 'Semaine'}
		{#if semaineDeTest}<span class="badge badge--test">TEST</span>{/if}
	</button>
</div>

{#if view === 'semaine'}
	<div class="tabs">
		{#each data.weeks as week (week.id)}
			<a class="tab" class:tab--active={week.id === data.week?.id} href="/classement?semaine={week.id}">
				{week.label}
				{#if isTestWeek(week.testKind)}<span class="badge badge--test">TEST</span>{/if}
			</a>
		{/each}
	</div>

	{#if semaineDeTest}
		<div class="alert alert--warn small">
			<strong>Semaine de test.</strong> Ce classement hebdomadaire est le seul endroit ou ses points
			apparaissent : ils sont exclus du classement general, du graphe d'evolution et des
			statistiques des joueurs.
		</div>
	{/if}
{/if}

<div class="card">
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">#</th>
					<th>Joueur</th>
					<th class="num">Points</th>
					<th class="num">Reussite</th>
					<th class="num">Scores exacts</th>
					<th class="num">Ecarts exacts</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.userId)}
					<tr class:me={row.userId === me}>
						<td class="num">{row.rank}</td>
						<td><a href="/joueur/{row.userId}">{row.pseudo}</a></td>
						<td class="num"><strong>{row.points}</strong></td>
						<td class="num">{row.played > 0 ? percent(row.successRate) : '—'}</td>
						<td class="num">{row.exactScores}</td>
						<td class="num">{row.exactMargins}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="tiny muted" style="margin:0.7rem 0 0">
		Departage a egalite : nombre de scores exacts, puis nombre de bons ecarts.
		{#if view === 'general'}
			Les semaines marquees TEST sont exclues de ce classement.
		{/if}
	</p>
</div>

<div class="card">
	<h2>Evolution des positions</h2>
	<p class="tiny muted" style="margin:-0.3rem 0 0.8rem">
		Rang au classement general apres chaque semaine. Ta courbe est en vert ; survole une autre
		courbe pour l'identifier.
	</p>
	<RankChart weeks={data.evolution.weeks} series={data.evolution.series} highlightUserId={me} />
</div>
