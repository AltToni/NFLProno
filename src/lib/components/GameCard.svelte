<script lang="ts">
	import { enhance } from '$app/forms';
	import type { BoardGame } from '$lib/types';
	import LocalTime from './LocalTime.svelte';
	import Countdown from './Countdown.svelte';
	import { GAME_STATUS_LABEL } from '$lib/nfl';

	let {
		game,
		error = null,
		saved = false
	}: {
		game: BoardGame;
		error?: string | null;
		saved?: boolean;
	} = $props();

	let side = $state<'home' | 'away' | null>(null);
	let homeScore = $state<number | null>(null);
	let awayScore = $state<number | null>(null);
	let saving = $state(false);
	let justSaved = $state(false);

	/**
	 * Les champs suivent le pronostic renvoye par le serveur : initialisation au
	 * montage, puis resynchronisation apres chaque `update()` de use:enhance, un
	 * verrouillage ou une correction admin. L'effet ne depend que de `game.pick`
	 * (les ecritures ne creent pas de dependance), donc la saisie en cours n'est
	 * jamais ecrasee tant que le serveur ne renvoie pas autre chose.
	 */
	$effect(() => {
		const pick = game.pick;
		side = pick?.pickSide ?? null;
		homeScore = pick?.scoreHomePred ?? null;
		awayScore = pick?.scoreAwayPred ?? null;
	});

	const editable = $derived(!game.locked && !game.neutralized);
	const finished = $derived(game.status === 'final');

	const dirty = $derived(
		side !== (game.pick?.pickSide ?? null) ||
			homeScore !== (game.pick?.scoreHomePred ?? null) ||
			awayScore !== (game.pick?.scoreAwayPred ?? null)
	);

	const complete = $derived(side !== null && homeScore !== null && awayScore !== null);

	/**
	 * Le score saisi ne peut pas donner la victoire a l'equipe non choisie :
	 * meme regle que le controle serveur, verifiee ici pour l'affichage.
	 */
	const inconsistent = $derived(
		complete &&
			(homeScore as number) !== (awayScore as number) &&
			((homeScore as number) > (awayScore as number) ? side !== 'home' : side !== 'away')
	);

	function choose(next: 'home' | 'away') {
		if (!editable) return;
		side = next;
		// Si le score deja saisi contredit le nouveau choix, on l'inverse.
		if (homeScore !== null && awayScore !== null && homeScore !== awayScore) {
			const homeWins = homeScore > awayScore;
			if ((next === 'home' && !homeWins) || (next === 'away' && homeWins)) {
				[homeScore, awayScore] = [awayScore, homeScore];
			}
		}
	}

	const realWinner = $derived(
		finished && game.scoreHome !== null && game.scoreAway !== null
			? game.scoreHome > game.scoreAway
				? 'home'
				: game.scoreHome < game.scoreAway
					? 'away'
					: 'draw'
			: null
	);
</script>

<div class="game" class:game--locked={!editable}>
	<div class="game__head">
		<span>
			<LocalTime value={game.kickoffUtc} />
			{#if game.fallbackOdds}
				<span class="badge badge--locked" title="Cotes indisponibles au snapshot : bareme 50/50"
					>cotes absentes</span
				>
			{/if}
		</span>

		<span class="row">
			{#if game.neutralized}
				<span class="badge badge--locked">{GAME_STATUS_LABEL[game.status] ?? game.status}</span>
			{:else if game.status === 'in'}
				<span class="badge badge--live">en direct {game.scoreAway}–{game.scoreHome}</span>
			{:else if finished}
				<span class="badge">final {game.scoreAway}–{game.scoreHome}</span>
			{:else if game.locked}
				<span class="badge badge--locked">verrouille</span>
			{:else}
				<Countdown target={game.kickoffUtc} prefix="dans " />
			{/if}
			<a class="badge" href="/match/{game.id}">details</a>
		</span>
	</div>

	<form
		method="POST"
		action="/pronostics?/pronostic"
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
		<input type="hidden" name="gameId" value={game.id} />
		<input type="hidden" name="pickSide" value={side ?? ''} />

		<div class="teams">
			<button
				type="button"
				class="team"
				class:team--selected={side === 'away'}
				class:team--winner={realWinner === 'away'}
				disabled={!editable}
				onclick={() => choose('away')}
			>
				{#if game.awayLogo}
					<img class="team__logo" src={game.awayLogo} alt="" loading="lazy" />
				{/if}
				<span class="team__abbr">{game.awayAbbr}</span>
				<span class="team__stake">
					{game.basePointsAway !== null ? `${game.basePointsAway} pts` : '—'}
				</span>
			</button>

			<div class="vs">
				<span>@</span>
				{#if finished}
					<strong class="small">{game.scoreAway}–{game.scoreHome}</strong>
				{/if}
			</div>

			<button
				type="button"
				class="team"
				class:team--selected={side === 'home'}
				class:team--winner={realWinner === 'home'}
				disabled={!editable}
				onclick={() => choose('home')}
			>
				{#if game.homeLogo}
					<img class="team__logo" src={game.homeLogo} alt="" loading="lazy" />
				{/if}
				<span class="team__abbr">{game.homeAbbr}</span>
				<span class="team__stake">
					{game.basePointsHome !== null ? `${game.basePointsHome} pts` : '—'}
				</span>
			</button>
		</div>

		<div class="score-inputs">
			<input
				type="number"
				name="scoreAwayPred"
				min="0"
				max="99"
				inputmode="numeric"
				placeholder="—"
				disabled={!editable}
				aria-label="Score predit {game.awayAbbr}"
				bind:value={awayScore}
			/>
			<span class="muted small">score</span>
			<input
				type="number"
				name="scoreHomePred"
				min="0"
				max="99"
				inputmode="numeric"
				placeholder="—"
				disabled={!editable}
				aria-label="Score predit {game.homeAbbr}"
				bind:value={homeScore}
			/>
		</div>

		{#if editable}
			<div class="between" style="margin-top:0.6rem">
				<span class="tiny muted">
					{#if inconsistent}
						<span style="color:var(--danger)">
							Le score donne la victoire a l'autre equipe.
						</span>
					{:else if game.pick}
						Enregistre — modifiable jusqu'au kickoff.
					{:else}
						Choisis une equipe et un score.
					{/if}
				</span>
				<button
					class="btn btn--primary btn--sm"
					type="submit"
					disabled={saving || !complete || inconsistent || (!dirty && !!game.pick)}
				>
					{saving ? '…' : justSaved || saved ? 'Enregistre ✓' : 'Enregistrer'}
				</button>
			</div>
		{:else if game.pick}
			<div class="between" style="margin-top:0.6rem">
				<span class="tiny muted">
					Ton prono : <strong>{game.pick.pickSide === 'home' ? game.homeAbbr : game.awayAbbr}</strong>
					{game.pick.scoreAwayPred}–{game.pick.scoreHomePred}
				</span>
				{#if game.points !== null}
					<span class="badge" class:badge--open={game.points > 0}>{game.points} pts</span>
				{/if}
			</div>
		{:else}
			<div class="tiny muted" style="margin-top:0.6rem">
				{game.neutralized ? 'Match neutralise : 0 point pour tout le monde.' : 'Aucun pronostic — 0 point.'}
			</div>
		{/if}

		{#if error}
			<div class="alert alert--error small" style="margin:0.6rem 0 0">{error}</div>
		{/if}
	</form>
</div>
