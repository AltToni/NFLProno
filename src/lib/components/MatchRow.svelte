<script lang="ts">
	import type { BoardGame } from '$lib/types';
	import LocalTime from './LocalTime.svelte';
	import Icon from './Icon.svelte';
	import { pickLabel } from '$lib/nfl';

	/**
	 * Ligne compacte d'un match, pour la liste de l'accueil.
	 *
	 * Elle porte **l'enjeu de chaque camp** sous l'abreviation. La maquette
	 * n'en montrait pas — elle ne connait pas le bareme — mais c'est le coeur du
	 * jeu : savoir qu'une equipe vaut 138 points et l'autre 32 est ce qui rend
	 * le choix interessant, et cette information doit etre lisible avant meme
	 * d'ouvrir la grille.
	 */
	let { game, weekId }: { game: BoardGame; weekId: number } = $props();

	const ouvert = $derived(!game.locked && !game.neutralized);
	const fini = $derived(game.status === 'final');
	const enjeux = $derived(game.basePointsHome !== null && game.basePointsAway !== null);
</script>

<div class="mrow">
	<div class="mrow__quand tiny muted">
		<LocalTime value={game.kickoffUtc} />
	</div>

	<div class="mrow__camp">
		{#if game.awayLogo}
			<img class="mrow__logo" src={game.awayLogo} alt="" loading="lazy" />
		{/if}
		<div class="mrow__ident">
			<span class="mrow__abbr">{game.awayAbbr}</span>
			<span class="mrow__nom">{game.awayName}</span>
			{#if enjeux}<span class="mrow__enjeu">{game.basePointsAway} pts</span>{/if}
		</div>
	</div>

	<div class="mrow__vs">
		{#if fini}
			<strong class="num">{game.scoreAway}–{game.scoreHome}</strong>
		{:else}
			<span class="muted">@</span>
		{/if}
	</div>

	<div class="mrow__camp">
		{#if game.homeLogo}
			<img class="mrow__logo" src={game.homeLogo} alt="" loading="lazy" />
		{/if}
		<div class="mrow__ident">
			<span class="mrow__abbr">{game.homeAbbr}</span>
			<span class="mrow__nom">{game.homeName}</span>
			{#if enjeux}<span class="mrow__enjeu">{game.basePointsHome} pts</span>{/if}
		</div>
	</div>

	<div class="mrow__action">
		{#if game.neutralized}
			<span class="badge badge--locked">neutralise</span>
		{:else if ouvert && game.pick}
			<a class="btn btn--sm" href="/pronostics?semaine={weekId}#match-{game.id}">
				{pickLabel(game.pick, game.homeAbbr, game.awayAbbr)}
				<Icon name="chevron-droite" size={14} />
			</a>
		{:else if ouvert}
			<a class="btn btn--sm btn--primary" href="/pronostics?semaine={weekId}#match-{game.id}">
				Pronostiquer
			</a>
		{:else if game.points !== null}
			<span class="badge" class:badge--open={game.points > 0}>{game.points} pts</span>
		{:else}
			<a class="btn btn--sm" href="/match/{game.id}">Details</a>
		{/if}
	</div>
</div>

<style>
	/*
	 * Une seule grille, deux mises en page : sur telephone l'heure passe au
	 * dessus et l'action a droite, sur grand ecran tout tient sur une ligne.
	 */
	.mrow {
		display: grid;
		grid-template-columns: 1fr auto 1fr auto;
		grid-template-areas:
			'quand quand quand action'
			'away vs home action';
		align-items: center;
		gap: 0.4rem 0.6rem;
		padding: 0.8rem 0.9rem;
	}

	.mrow__quand {
		grid-area: quand;
		white-space: nowrap;
	}
	.mrow__vs {
		grid-area: vs;
		text-align: center;
		font-size: 0.85rem;
		min-width: 2rem;
	}
	.mrow__action {
		grid-area: action;
		justify-self: end;
	}
	.mrow__camp:first-of-type {
		grid-area: away;
	}
	.mrow__camp:last-of-type {
		grid-area: home;
	}

	.mrow__camp {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.mrow__logo {
		width: 30px;
		height: 30px;
		object-fit: contain;
		flex: none;
	}
	.mrow__ident {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.mrow__abbr {
		font-weight: 700;
		font-family: var(--font-display);
		letter-spacing: -0.01em;
		line-height: 1.15;
		white-space: nowrap;
	}
	/* Le nom complet n'apparait que quand il y a la place pour lui. */
	.mrow__nom {
		display: none;
	}
	/*
	 * L'enjeu ne se coupe jamais en deux lignes : « 125 » au-dessus de « pts »
	 * se lit comme deux informations, alors que c'en est une seule.
	 */
	.mrow__enjeu {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		line-height: 1.3;
		white-space: nowrap;
	}

	@media (min-width: 720px) {
		.mrow {
			grid-template-columns: 7.5rem 1fr auto 1fr auto;
			grid-template-areas: 'quand away vs home action';
			gap: 0.75rem;
			padding: 0.85rem 1rem;
		}
		.mrow__quand {
			white-space: normal;
		}
		.mrow__nom {
			display: block;
			font-size: 0.9rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.mrow__abbr {
			display: none;
		}
	}
</style>
