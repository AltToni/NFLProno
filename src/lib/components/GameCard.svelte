<script lang="ts">
	import type { BoardGame, EtatCarte } from '$lib/types';
	import LocalTime from './LocalTime.svelte';
	import Countdown from './Countdown.svelte';
	import { GAME_STATUS_LABEL, marginLabel, pickLabel } from '$lib/nfl';
	import { SPLIT_CHOICES, type PickMode, type PickSide } from '$lib/scoring';

	let {
		game,
		error = null,
		report
	}: {
		game: BoardGame;
		error?: string | null;
		report?: (etat: EtatCarte) => void;
	} = $props();

	/** Le mode par defaut du jeu : vainqueur + split. */
	let mode = $state<PickMode>('margin');
	let side = $state<PickSide | null>(null);
	/** Mode split : « Match nul » = ecart 0 et aucune equipe designee. */
	let nul = $state(false);
	let margin = $state<number | null>(null);
	let homeScore = $state<number | null>(null);
	let awayScore = $state<number | null>(null);

	/**
	 * Les champs suivent le pronostic renvoye par le serveur : initialisation au
	 * montage, puis resynchronisation apres chaque `update()` de use:enhance, un
	 * verrouillage ou une correction admin. L'effet ne depend que de `game.pick`
	 * (les ecritures ne creent pas de dependance), donc la saisie en cours n'est
	 * jamais ecrasee tant que le serveur ne renvoie pas autre chose. Le mode fait
	 * partie du pronostic : il est memorise match par match.
	 */
	$effect(() => {
		const pick = game.pick;
		mode = pick?.mode ?? 'margin';
		side = pick?.pickSide ?? null;
		nul = pick?.mode === 'margin' && pick.marginPred === 0;
		margin = pick?.marginPred ?? null;
		homeScore = pick?.scoreHomePred ?? null;
		awayScore = pick?.scoreAwayPred ?? null;
	});

	const editable = $derived(!game.locked && !game.neutralized);
	const finished = $derived(game.status === 'final');

	/** Ecart signe que le score saisi implique, base de l'apercu du mode score. */
	const derivedDiff = $derived(
		homeScore !== null && awayScore !== null ? homeScore - awayScore : null
	);

	/**
	 * En mode score, le vainqueur *se deduit* du score : on le tient a jour au
	 * fil de la frappe plutot que de laisser le joueur se contredire. Un score
	 * nul, lui, ne designe personne : le choix d'equipe est alors conserve, il
	 * decide des points si le match ne finit finalement pas nul (spec 2.4).
	 */
	$effect(() => {
		if (mode !== 'score' || derivedDiff === null || derivedDiff === 0) return;
		side = derivedDiff > 0 ? 'home' : 'away';
	});

	/**
	 * Un split hors liste : un pronostic d'avant la liste fermee, ou repris d'une
	 * saisie libre. Il reste valable et se calcule normalement, mais il faut le
	 * rejouer pour pouvoir reenregistrer la carte.
	 */
	const splitHorsListe = $derived(
		mode === 'margin' &&
			!nul &&
			margin !== null &&
			!(SPLIT_CHOICES as readonly number[]).includes(margin)
	);

	const vide = $derived(
		mode === 'margin'
			? !nul && side === null && margin === null
			: side === null && homeScore === null && awayScore === null
	);

	const complet = $derived(
		mode === 'margin'
			? nul || (side !== null && margin !== null && !splitHorsListe)
			: side !== null && homeScore !== null && awayScore !== null
	);

	/**
	 * Ecart signe du pronostic en cours de saisie, ou null s'il n'en dit pas
	 * encore assez. Les deux modes convergent ici : c'est ce qui permet
	 * d'afficher « KC +7 » sous une saisie comme sous l'autre.
	 */
	const previewDiff = $derived.by(() => {
		if (mode !== 'margin') return derivedDiff;
		if (nul) return 0;
		return side !== null && margin !== null ? (side === 'home' ? margin : -margin) : null;
	});

	const modifie = $derived.by(() => {
		const pick = game.pick;
		if (!pick || pick.mode !== mode) return true;
		if (mode === 'margin') {
			return (nul ? 0 : margin) !== pick.marginPred || (nul ? null : side) !== pick.pickSide;
		}
		return (
			side !== pick.pickSide ||
			homeScore !== pick.scoreHomePred ||
			awayScore !== pick.scoreAwayPred
		);
	});

	// Remontee a la page. `report` n'est pas lu comme dependance : seul l'etat
	// derive declenche l'effet, donc pas de boucle avec le parent.
	$effect(() => {
		const etat = { vide, complet, modifie };
		if (editable) report?.(etat);
	});

	function choose(next: PickSide) {
		if (!editable) return;
		side = next;
		if (mode === 'margin') {
			nul = false;
			return;
		}
		// Si le score deja saisi contredit le nouveau choix, on l'inverse.
		if (homeScore !== null && awayScore !== null && homeScore !== awayScore) {
			const homeWins = homeScore > awayScore;
			if ((next === 'home' && !homeWins) || (next === 'away' && homeWins)) {
				[homeScore, awayScore] = [awayScore, homeScore];
			}
		}
	}

	function chooseSplit(valeur: number) {
		if (!editable) return;
		nul = false;
		// Rejouer le split deja retenu le retire : c'est le seul moyen de revenir
		// a une carte vierge sans recharger la page.
		margin = margin === valeur && !nul ? null : valeur;
	}

	function chooseNul() {
		if (!editable) return;
		nul = !nul;
		if (nul) {
			side = null;
			margin = null;
		}
	}

	/**
	 * Bascule de mode. Passer au mode split reprend ce que le score saisi disait
	 * deja, a condition que l'ecart corresponde a un split jouable — l'inverse
	 * est impossible, un split ne contient aucun score.
	 */
	function switchMode(next: PickMode) {
		if (!editable || mode === next) return;
		if (next === 'margin' && !nul && margin === null && derivedDiff !== null) {
			if (derivedDiff === 0) {
				nul = true;
				side = null;
			} else if ((SPLIT_CHOICES as readonly number[]).includes(Math.abs(derivedDiff))) {
				margin = Math.abs(derivedDiff);
			}
		}
		mode = next;
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

<!-- L'ancre permet a l'accueil de pointer une carte precise de la grille. -->
<div
	id="match-{game.id}"
	class="game"
	class:game--locked={!editable}
	class:game--error={!!error}
>
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

	{#if editable}
		<!-- Champs de la grille : c'est le formulaire unique de la page qui les
		     envoie. Le nom porte l'identifiant du match, seul moyen de recoller
		     chaque valeur a sa carte cote serveur. -->
		<input type="hidden" name="jeu" value={game.id} />
		<input type="hidden" name="mode:{game.id}" value={mode} />
		<input type="hidden" name="side:{game.id}" value={mode === 'margin' && nul ? '' : (side ?? '')} />
		<input type="hidden" name="modifie:{game.id}" value={modifie ? '1' : ''} />
		{#if mode === 'margin'}
			<input type="hidden" name="margin:{game.id}" value={nul ? 0 : (margin ?? '')} />
		{/if}

		<div class="modes" role="group" aria-label="Mode de saisie">
			<button
				type="button"
				class="tab"
				class:tab--active={mode === 'margin'}
				aria-pressed={mode === 'margin'}
				onclick={() => switchMode('margin')}
			>
				Vainqueur + split
			</button>
			<button
				type="button"
				class="tab"
				class:tab--active={mode === 'score'}
				aria-pressed={mode === 'score'}
				onclick={() => switchMode('score')}
			>
				Score
			</button>
		</div>
	{/if}

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

	{#if editable && mode === 'margin'}
		<div class="splits" role="group" aria-label="Split predit">
			<button
				type="button"
				class="split split--nul"
				class:split--active={nul}
				aria-pressed={nul}
				onclick={chooseNul}
			>
				Match nul
			</button>
			{#each SPLIT_CHOICES as valeur (valeur)}
				<button
					type="button"
					class="split"
					class:split--active={!nul && margin === valeur}
					aria-pressed={!nul && margin === valeur}
					onclick={() => chooseSplit(valeur)}
				>
					+{valeur}
				</button>
			{/each}
		</div>
		{#if splitHorsListe}
			<p class="tiny" style="margin:0.4rem 0 0;color:var(--warn)">
				Ton pronostic enregistre est un ecart de {margin} points, qui n'est plus proposé. Il reste
				valable tel quel ; choisis un split ci-dessus pour le remplacer.
			</p>
		{/if}
	{:else if editable}
		<div class="score-inputs">
			<input
				type="number"
				name="away:{game.id}"
				min="0"
				max="99"
				inputmode="numeric"
				placeholder="—"
				aria-label="Score predit {game.awayAbbr}"
				bind:value={awayScore}
			/>
			<span class="muted small">score</span>
			<input
				type="number"
				name="home:{game.id}"
				min="0"
				max="99"
				inputmode="numeric"
				placeholder="—"
				aria-label="Score predit {game.homeAbbr}"
				bind:value={homeScore}
			/>
		</div>
	{/if}

	{#if editable}
		<div class="tiny muted" style="margin-top:0.6rem">
			{#if mode === 'score' && derivedDiff === 0 && side === null}
				Nul predit : choisis aussi l'equipe a crediter si le match ne finit pas nul.
			{:else if previewDiff !== null}
				Soit <strong>{marginLabel(previewDiff, game.homeAbbr, game.awayAbbr)}</strong>
				{#if mode === 'margin' && nul}
					— ×1,5 si le match finit nul, 0 sinon : aucune equipe n'est designee.
				{:else if mode === 'margin'}
					— ×1,5 si le split est exact, ×1,375 s'il est rate d'un point, jamais de ×2.
				{:else}
					— ×1,5 si l'ecart est exact, ×2 si le score l'est. Pas de bonus de proximite.
				{/if}
				{#if game.pick && !modifie}· enregistre, modifiable jusqu'au kickoff{/if}
			{:else if mode === 'margin'}
				Choisis une equipe et un split, ou « Match nul ».
			{:else}
				Saisis les deux scores : le vainqueur et l'ecart s'en deduisent.
			{/if}
		</div>
	{:else if game.pick}
		<div class="between" style="margin-top:0.6rem">
			<span class="tiny muted">
				Ton prono : <strong>{pickLabel(game.pick, game.homeAbbr, game.awayAbbr)}</strong>
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
</div>
