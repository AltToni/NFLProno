<script lang="ts">
	/**
	 * Anneau de progression du bloc « Mon recap ».
	 *
	 * Il represente le **taux de reussite** — la seule grandeur de ce bloc qui
	 * soit bornee. Les points de la semaine, eux, n'ont pas de maximum connu :
	 * les afficher en proportion d'un total invente serait faux. Ils occupent
	 * donc le centre, en clair, et l'anneau dit dans quelle mesure ils ont ete
	 * bien joues.
	 */
	let {
		ratio,
		valeur,
		unite = 'PTS',
		size = 132,
		epaisseur = 13
	}: {
		/** Entre 0 et 1. */
		ratio: number;
		valeur: number | string;
		unite?: string;
		size?: number;
		epaisseur?: number;
	} = $props();

	const rayon = $derived((size - epaisseur) / 2);
	const perimetre = $derived(2 * Math.PI * rayon);
	const borne = $derived(Math.max(0, Math.min(1, ratio)));
	const rempli = $derived(perimetre * borne);
</script>

<div class="ring" style="width:{size}px;height:{size}px">
	<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
		<circle
			cx={size / 2}
			cy={size / 2}
			r={rayon}
			fill="none"
			stroke="var(--surface-3)"
			stroke-width={epaisseur}
		/>
		<!-- Depart a midi : rotation de -90deg autour du centre. -->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={rayon}
			fill="none"
			stroke="var(--positive)"
			stroke-width={epaisseur}
			stroke-linecap="round"
			stroke-dasharray="{rempli} {perimetre}"
			transform="rotate(-90 {size / 2} {size / 2})"
		/>
	</svg>
	<div class="ring__centre">
		<strong style="font-size:{Math.round(size * 0.26)}px">{valeur}</strong>
		<span class="tiny muted">{unite}</span>
	</div>
</div>

<style>
	.ring {
		position: relative;
		flex: none;
	}
	.ring__centre {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
	}
	.ring__centre strong {
		font-family: var(--font-display);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
</style>
