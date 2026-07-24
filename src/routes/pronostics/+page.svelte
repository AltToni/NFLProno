<script lang="ts">
	import GameCard from '$lib/components/GameCard.svelte';
	import Countdown from '$lib/components/Countdown.svelte';
	import { dayKey, formatDayHeading, formatDateTime } from '$lib/time';
	import type { BoardGame } from '$lib/types';

	let { data, form } = $props();

	const games = $derived(data.games as BoardGame[]);

	// Regroupement par jour, en heure belge (reference commune du groupe).
	const groups = $derived.by(() => {
		const map = new Map<string, BoardGame[]>();
		for (const game of games) {
			const key = dayKey(game.kickoffUtc);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(game);
		}
		return [...map.entries()].map(([key, list]) => ({
			key,
			heading: formatDayHeading(list[0].kickoffUtc),
			games: list
		}));
	});

	const openGames = $derived(games.filter((g) => !g.locked && !g.neutralized));
	const done = $derived(games.filter((g) => g.pick !== null).length);
	const playable = $derived(games.filter((g) => !g.neutralized).length);
	const missing = $derived(openGames.filter((g) => g.pick === null).length);
	const nextKickoff = $derived(
		openGames.length > 0 ? Math.min(...openGames.map((g) => g.kickoffUtc)) : null
	);
	const weekPoints = $derived(
		games.reduce((sum, g) => sum + (g.points ?? 0), 0)
	);
</script>

<svelte:head><title>Mes pronostics — Pronos NFL</title></svelte:head>

{#if !data.week}
	<div class="card center">
		<h1>Aucune semaine ouverte</h1>
		<p class="muted">
			Le premier snapshot des cotes n'a pas encore tourne. Les pronostics s'ouvrent chaque
			<strong>mercredi a 09:00</strong>.
		</p>
	</div>
{:else}
	<div class="tabs">
		{#each data.weeks as week (week.id)}
			<a
				class="tab"
				class:tab--active={week.id === data.week.id}
				href="/pronostics?semaine={week.id}">{week.label}</a
			>
		{/each}
	</div>

	<div class="between wrap" style="margin-bottom:0.85rem">
		<div>
			<h1 style="margin-bottom:0.2rem">{data.week.label}</h1>
			<p class="small muted" style="margin:0">
				{done}/{playable} pronostiques
				{#if data.week.status === 'cloturee'}
					· semaine cloturee · <strong>{weekPoints} pts</strong>
				{:else if weekPoints > 0}
					· <strong>{weekPoints} pts</strong> acquis
				{/if}
				{#if data.multiplier !== 1}
					· multiplicateur ×{data.multiplier}
				{/if}
			</p>
		</div>
		{#if nextKickoff}
			<div class="card" style="margin:0;padding:0.5rem 0.8rem">
				<div class="tiny muted">prochain kickoff</div>
				<strong><Countdown target={nextKickoff} /></strong>
			</div>
		{/if}
	</div>

	{#if data.week.snapshotAt}
		<p class="tiny muted" style="margin:-0.4rem 0 1rem">
			Bareme fige le {formatDateTime(data.week.snapshotAt)} — les enjeux affiches ne bougent plus.
		</p>
	{/if}

	{#if data.week.status === 'ouverte' && missing > 0}
		<div class="alert alert--warn small">
			Il te reste <strong>{missing}</strong> match(s) a pronostiquer avant leur kickoff.
		</div>
	{/if}

	{#each groups as group (group.key)}
		<h2 class="day-heading">{group.heading}</h2>
		{#each group.games as game (game.id)}
			<GameCard
				{game}
				error={form?.gameId === game.id ? (form.error ?? null) : null}
				saved={form?.gameId === game.id && form?.saved === true}
			/>
		{/each}
	{/each}

	{#if games.length === 0}
		<div class="card center muted">Aucun match pour cette semaine.</div>
	{/if}
{/if}
