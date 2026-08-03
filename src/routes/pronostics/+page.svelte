<script lang="ts">
	import { enhance } from '$app/forms';
	import GameCard from '$lib/components/GameCard.svelte';
	import Countdown from '$lib/components/Countdown.svelte';
	import { isTestWeek, TEST_KIND_LABEL, type TestKind } from '$lib/nfl';
	import { dayKey, formatDayHeading, formatDateTime } from '$lib/time';
	import type { BoardGame, EtatCarte } from '$lib/types';

	let { data, form } = $props();

	const games = $derived(data.games as BoardGame[]);
	const testKind = $derived(data.week?.testKind ?? null);

	/**
	 * Etat de saisie de chaque carte, remonte par `GameCard`. C'est ce qui permet
	 * a un bouton unique de savoir ce qu'il y a a enregistrer, et a la page
	 * d'avertir *avant* l'envoi plutot qu'apres.
	 */
	let etats = $state<Record<string, EtatCarte>>({});
	let saving = $state(false);
	let justSaved = $state(false);

	const etat = (id: string): EtatCarte | undefined => etats[id];

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
	const nextKickoff = $derived(
		openGames.length > 0 ? Math.min(...openGames.map((g) => g.kickoffUtc)) : null
	);
	const weekPoints = $derived(
		games.reduce((sum, g) => sum + (g.points ?? 0), 0)
	);

	/** Modifie et complet : ce que le bouton unique va reellement ecrire. */
	const aEnregistrer = $derived(
		openGames.filter((g) => etat(g.id)?.complet && etat(g.id)?.modifie)
	);

	/** Saisie commencee mais pas finie : le serveur la refuserait, on le dit avant. */
	const incomplets = $derived(
		openGames.filter((g) => {
			const e = etat(g.id);
			return e && !e.vide && !e.complet && e.modifie;
		})
	);

	/** Aucun pronostic en base, et rien d'enregistrable en l'etat. */
	const manquants = $derived(
		openGames.filter((g) => g.pick === null && !etat(g.id)?.complet)
	);

	const libelleMatch = (g: BoardGame) => `${g.awayAbbr} @ ${g.homeAbbr}`;

	/** Le bouton reste actif tant qu'il y a quelque chose a ecrire. */
	const peutEnregistrer = $derived(aEnregistrer.length > 0);
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
				href="/pronostics?semaine={week.id}"
			>
				{week.label}
				{#if isTestWeek(week.testKind)}<span class="badge badge--test">TEST</span>{/if}
			</a>
		{/each}
	</div>

	{#if isTestWeek(testKind)}
		<div class="alert alert--warn small">
			<strong>Semaine de test — {TEST_KIND_LABEL[testKind as TestKind]}.</strong>
			Elle sert a verifier le fonctionnement du jeu : ses points ne comptent
			<strong>ni au classement general ni dans tes statistiques</strong>, et elle sera supprimee
			par l'administrateur.
			{#if testKind === 'rejeu'}
				Les matchs viennent de la saison {data.week.sourceSeason} et sont deja termines : les
				scores sont visibles et la saisie reste ouverte malgre les kickoffs passes.
			{:else}
				Les kickoffs sont dans quelques minutes et le verrouillage s'applique normalement.
			{/if}
		</div>
	{/if}

	<div class="between wrap" style="margin-bottom:0.85rem">
		<div>
			<h1 style="margin-bottom:0.2rem">
				{data.week.label}
				{#if isTestWeek(testKind)}<span class="badge badge--test">TEST</span>{/if}
			</h1>
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
				· <a href="/regles" style="text-decoration:underline">comment sont calcules les points ?</a>
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

	{#if form?.enregistres}
		<div class="alert alert--ok small">
			<strong>{form.enregistres}</strong> pronostic(s) enregistre(s).
		</div>
	{/if}

	<form
		method="POST"
		action="?/pronostics"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
				justSaved = true;
				setTimeout(() => (justSaved = false), 2500);
			};
		}}
	>
		{#each groups as group (group.key)}
			<h2 class="day-heading">{group.heading}</h2>
			{#each group.games as game (game.id)}
				<GameCard
					{game}
					error={form?.erreurs?.[game.id] ?? null}
					report={(e) => (etats[game.id] = e)}
				/>
			{/each}
		{/each}

		{#if games.length === 0}
			<div class="card center muted">Aucun match pour cette semaine.</div>
		{/if}

		{#if openGames.length > 0}
			<div class="barre-saisie">
				<div class="barre-saisie__etat">
					{#if incomplets.length > 0}
						<div class="tiny" style="color:var(--warn)">
							<strong>{incomplets.length} pronostic(s) incomplet(s)</strong> —
							{incomplets.map(libelleMatch).join(', ')}. Ils ne seront pas enregistres.
						</div>
					{/if}
					{#if manquants.length > 0}
						<div class="tiny muted">
							<strong>{manquants.length} match(s) sans pronostic</strong> —
							{manquants.map(libelleMatch).join(', ')}. Sans pronostic, c'est 0 point.
						</div>
					{/if}
					{#if incomplets.length === 0 && manquants.length === 0}
						<div class="tiny muted">
							{#if peutEnregistrer}
								{aEnregistrer.length} modification(s) a enregistrer.
							{:else}
								Grille complete — tout est enregistre.
							{/if}
						</div>
					{/if}
				</div>

				<button class="btn btn--primary" type="submit" disabled={saving || !peutEnregistrer}>
					{#if saving}
						…
					{:else if justSaved && !peutEnregistrer}
						Enregistre ✓
					{:else if peutEnregistrer}
						Enregistrer ({aEnregistrer.length})
					{:else}
						Enregistrer
					{/if}
				</button>
			</div>
		{/if}
	</form>
{/if}
