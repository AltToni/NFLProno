<script lang="ts">
	import type { BoardGame, EtatCarte } from '$lib/types';
	import LocalTime from './LocalTime.svelte';
	import Countdown from './Countdown.svelte';
	import { bonusApplique, GAME_STATUS_LABEL, marginLabel, pickLabel } from '$lib/nfl';
	import {
		bonusEcartExact,
		DEFAULT_SCORING,
		ECARTS_COURANTS,
		MARGIN_MAX,
		type PickSide,
		type ScoringConfig
	} from '$lib/scoring';

	let {
		game,
		error = null,
		report,
		bareme = DEFAULT_SCORING
	}: {
		game: BoardGame;
		error?: string | null;
		report?: (etat: EtatCarte) => void;
		/** Bareme courant : il decide du bonus annonce sous la saisie. */
		bareme?: ScoringConfig;
	} = $props();

	let side = $state<PickSide | null>(null);
	/** « Match nul » = ecart 0, et aucune equipe designee. */
	let nul = $state(false);
	let margin = $state<number | null>(null);

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
		nul = pick != null && pick.marginPred === 0;
		margin = pick?.marginPred ?? null;
	});

	const editable = $derived(!game.locked && !game.neutralized);
	const finished = $derived(game.status === 'final');

	/** Ecart hors bornes : refuse a l'enregistrement, signale avant l'envoi. */
	const ecartHorsBornes = $derived(
		!nul && margin !== null && (margin < 1 || margin > MARGIN_MAX)
	);

	const vide = $derived(!nul && side === null && margin === null);
	const complet = $derived(nul || (side !== null && margin !== null && !ecartHorsBornes));

	/**
	 * Bonus que rapporterait l'ecart annonce s'il tombait pile. Recalcule a
	 * chaque frappe : c'est l'information qui rend le choix interessant, et elle
	 * doit bouger sous les doigts du joueur.
	 */
	const bonusAnnonce = $derived.by(() => {
		if (nul) return bonusEcartExact(0, bareme);
		if (margin === null || ecartHorsBornes) return null;
		return bonusEcartExact(margin, bareme);
	});

	const pct = (x: number) => `+${Math.round(x * 100)} %`;

	/**
	 * Bonus reellement obtenu, une fois le match compte. Il vient des points
	 * stockes, pas d'un recalcul : c'est la seule facon d'etre toujours d'accord
	 * avec le total affiche a cote.
	 */
	const bonusObtenu = $derived(bonusApplique(game.basePoints, game.bonusPoints));

	/** Ecart signe en cours de saisie, ou null s'il n'en dit pas encore assez. */
	const previewDiff = $derived.by(() => {
		if (nul) return 0;
		return side !== null && margin !== null ? (side === 'home' ? margin : -margin) : null;
	});

	const modifie = $derived.by(() => {
		const pick = game.pick;
		if (!pick) return true;
		return (nul ? 0 : margin) !== pick.marginPred || (nul ? null : side) !== pick.pickSide;
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
		nul = false;
	}

	/** Raccourci d'un ecart courant. Le rejouer le retire. */
	function chooseSplit(valeur: number) {
		if (!editable) return;
		const memeValeur = margin === valeur && !nul;
		nul = false;
		margin = memeValeur ? null : valeur;
	}

	/**
	 * Saisie libre de l'ecart. Un champ vide remet la carte a blanc plutot que
	 * de figer un 0, qui voudrait dire « match nul » — ce que le joueur n'a pas
	 * demande en effacant.
	 */
	function saisirEcart(brut: string) {
		if (!editable) return;
		const propre = brut.trim();
		if (propre === '') {
			margin = null;
			return;
		}
		const n = Number(propre);
		if (!Number.isInteger(n)) return;
		nul = false;
		margin = n;
	}

	function chooseNul() {
		if (!editable) return;
		nul = !nul;
		if (nul) {
			side = null;
			margin = null;
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
		<input type="hidden" name="side:{game.id}" value={nul ? '' : (side ?? '')} />
		<input type="hidden" name="modifie:{game.id}" value={modifie ? '1' : ''} />
		<input type="hidden" name="margin:{game.id}" value={nul ? 0 : (margin ?? '')} />
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

	{#if editable}
		<div class="ecart">
			<button
				type="button"
				class="split split--nul"
				class:split--active={nul}
				aria-pressed={nul}
				onclick={chooseNul}
			>
				Match nul
			</button>

			<div class="ecart__saisie">
				<label class="tiny muted" for="ecart-{game.id}">Ecart annonce</label>
				<div class="row">
					<input
						id="ecart-{game.id}"
						type="number"
						min="1"
						max={MARGIN_MAX}
						inputmode="numeric"
						placeholder="—"
						style="width:5rem"
						value={nul ? null : margin}
						oninput={(e) => saisirEcart((e.currentTarget as HTMLInputElement).value)}
					/>
					<!-- Le bonus se met a jour a la frappe : c'est lui qui rend le
					     choix d'un ecart interessant plutot qu'arbitraire. -->
					<span class="bonus" class:bonus--vide={bonusAnnonce === null}>
						{#if bonusAnnonce !== null}
							<strong>{pct(bonusAnnonce)}</strong>
							<span class="tiny">si l'ecart est exact</span>
						{:else}
							<span class="tiny">annonce un ecart pour voir le bonus</span>
						{/if}
					</span>
				</div>
			</div>

			<div class="ecart__courants" role="group" aria-label="Ecarts courants">
				{#each ECARTS_COURANTS as valeur (valeur)}
					<button
						type="button"
						class="split split--sm"
						class:split--active={!nul && margin === valeur}
						aria-pressed={!nul && margin === valeur}
						onclick={() => chooseSplit(valeur)}
					>
						+{valeur}
					</button>
				{/each}
			</div>
		</div>

		{#if ecartHorsBornes}
			<p class="tiny" style="margin:0.4rem 0 0;color:var(--warn)">
				L'ecart doit etre compris entre 1 et {MARGIN_MAX}, ou « Match nul ».
			</p>
		{/if}
	{/if}

	{#if editable}
		<div class="tiny muted" style="margin-top:0.6rem">
			{#if previewDiff !== null}
				Soit <strong>{marginLabel(previewDiff, game.homeAbbr, game.awayAbbr)}</strong>
				{#if nul}
					— <strong>{bonusAnnonce !== null ? pct(bonusAnnonce) : ''}</strong> si le match finit nul,
					0 sinon : aucune equipe n'est designee.
				{:else}
					— <strong>{bonusAnnonce !== null ? pct(bonusAnnonce) : ''}</strong> si l'ecart est exact,
					et un quart de moins par point d'erreur (rien au-dela de 4).
				{/if}
				{#if game.pick && !modifie}· enregistre, modifiable jusqu'au kickoff{/if}
			{:else}
				Choisis une equipe et annonce un ecart, ou « Match nul ».
			{/if}
		</div>
	{:else if game.pick}
		<div class="between" style="margin-top:0.6rem">
			<span class="tiny muted">
				Ton prono : <strong>{pickLabel(game.pick, game.homeAbbr, game.awayAbbr)}</strong>
				{#if bonusObtenu !== null}
					· {game.basePoints} × (1 + {Math.round(bonusObtenu * 100)} %)
				{/if}
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
