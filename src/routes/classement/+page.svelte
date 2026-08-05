<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import Podium from '$lib/components/Podium.svelte';
	import RankChart from '$lib/components/RankChart.svelte';
	import { isTestWeek } from '$lib/nfl';

	let { data } = $props();

	let view = $state<'general' | 'semaine'>('general');

	const me = $derived(data.user?.id ?? null);
	const rows = $derived(view === 'general' ? data.season : data.weekly);
	const semaineDeTest = $derived(isTestWeek(data.week?.testKind));

	/**
	 * Le podium ne montre que des joueurs ayant marque : trois avatars a zero
	 * point en debut de saison ne sont pas un classement, juste un ordre
	 * alphabetique deguise.
	 */
	const podium = $derived(rows.filter((r) => r.points > 0).slice(0, 3));
	const suite = $derived(podium.length === 3 ? rows.slice(3) : rows);

	function percent(value: number): string {
		return `${Math.round(value * 100)} %`;
	}
</script>

<svelte:head><title>Classement — Pronos NFL</title></svelte:head>

<div class="section-head">
	<h1 style="margin:0">Classement</h1>
	{#if view === 'semaine' && data.weeks.length > 0}
		<!-- Selecteur de semaine : une liste deroulante plutot qu'une rangee
		     d'onglets, la saison en comptant vingt-trois. -->
		<select
			class="select-semaine"
			aria-label="Semaine affichee"
			onchange={(e) => {
				const id = (e.currentTarget as HTMLSelectElement).value;
				location.href = `/classement?semaine=${id}`;
			}}
		>
			{#each data.weeks as week (week.id)}
				<option value={week.id} selected={week.id === data.week?.id}>{week.label}</option>
			{/each}
		</select>
	{/if}
</div>

<div class="tabs">
	<button class="tab" class:tab--active={view === 'general'} onclick={() => (view = 'general')}>
		General (saison)
	</button>
	<button class="tab" class:tab--active={view === 'semaine'} onclick={() => (view = 'semaine')}>
		{data.week?.label ?? 'Semaine'}
		{#if semaineDeTest}<span class="badge badge--test">TEST</span>{/if}
	</button>
</div>

{#if view === 'semaine' && semaineDeTest}
	<div class="alert alert--warn small">
		<strong>Semaine de test.</strong> Ce classement hebdomadaire est le seul endroit ou ses points
		apparaissent : ils sont exclus du classement general, du graphe d'evolution et des statistiques
		des joueurs.
	</div>
{/if}

{#if podium.length === 3}
	<Podium rows={podium} moi={me} />
{/if}

<div class="card">
	<div class="rows">
		{#each suite as row (row.userId)}
			<a class="line line--link" class:line--moi={row.userId === me} href="/joueur/{row.userId}">
				<span class="rang num" class:rang--top={row.rank <= 3}>{row.rank}</span>
				<Avatar pseudo={row.pseudo} src={row.avatar} size={34} />
				<span class="grow ellipsis">{row.pseudo}</span>
				<span class="line__stats tiny muted">
					{row.played > 0 ? percent(row.successRate) : '—'}
					· {row.exactMargins} exacts
				</span>
				<span class="pts">{row.points} <span class="tiny muted">PTS</span></span>
			</a>
		{/each}
	</div>

	{#if rows.length === 0}
		<p class="muted small center" style="margin:0.6rem 0">Aucun joueur a afficher.</p>
	{/if}

	<p class="tiny muted" style="margin:0.8rem 0 0">
		Departage a egalite : nombre d'ecarts exacts.
		{#if view === 'general'}
			Les semaines marquees TEST sont exclues de ce classement.
		{/if}
	</p>
</div>

<!-- Repliee par defaut : la liste au-dessus dit deja l'essentiel, ce tableau
     n'ajoute que les criteres de departage. -->
<details class="card">
	<summary><h2 style="display:inline;margin:0">Detail et departages</h2></summary>
	<div class="table-wrap" style="margin-top:0.9rem">
		<table>
			<thead>
				<tr>
					<th class="num">#</th>
					<th>Joueur</th>
					<th class="num">Points</th>
					<th class="num">Reussite</th>
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
						<td class="num">{row.exactMargins}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</details>

<div class="card">
	<h2>Evolution des positions</h2>
	<p class="tiny muted" style="margin:-0.3rem 0 0.8rem">
		Rang au classement general apres chaque semaine. Ta courbe est en vert ; survole une autre
		courbe pour l'identifier.
	</p>
	<RankChart weeks={data.evolution.weeks} series={data.evolution.series} highlightUserId={me} />
</div>

<style>
	summary {
		cursor: pointer;
		color: var(--muted);
	}
	summary:hover {
		color: var(--text);
	}

	.select-semaine {
		width: auto;
		min-width: 9rem;
		text-align: left;
		font-size: 0.88rem;
		padding: 0.45rem 0.6rem;
	}

	.rang {
		width: 1.7rem;
		text-align: center;
		font-weight: 700;
		color: var(--muted);
		flex: none;
	}
	.rang--top {
		color: var(--gold);
	}
	.line--moi {
		background: var(--accent-soft);
	}
	.ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		font-weight: 500;
	}

	/* Les statistiques secondaires cedent la place avant le pseudo et les points. */
	.line__stats {
		display: none;
		white-space: nowrap;
	}
	@media (min-width: 560px) {
		.line__stats {
			display: inline;
		}
	}
</style>
