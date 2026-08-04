<script lang="ts">
	/**
	 * Avatar d'un joueur : sa photo si la colonne `users.avatar` en porte une,
	 * sinon ses initiales sur un fond derive du pseudo.
	 *
	 * La teinte n'est pas decorative : deux joueurs voisins dans une liste
	 * doivent se distinguer d'un coup d'oeil, meme sans photo. Elle est tiree du
	 * pseudo, donc stable d'une page a l'autre.
	 */
	let {
		pseudo,
		src = null,
		size = 36,
		ring = false
	}: {
		pseudo: string;
		src?: string | null;
		size?: number;
		ring?: boolean;
	} = $props();

	const initiales = $derived(
		pseudo
			.split(/[\s-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((mot) => mot[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	/** Hachage stable et court : seule la teinte en sort. */
	const teinte = $derived.by(() => {
		let h = 0;
		for (let i = 0; i < pseudo.length; i++) h = (h * 31 + pseudo.charCodeAt(i)) % 360;
		return h;
	});
</script>

<span
	class="avatar"
	class:avatar--ring={ring}
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.38)}px;
	       background:{src ? 'transparent' : `hsl(${teinte} 42% 26%)`};
	       color:{src ? 'inherit' : `hsl(${teinte} 75% 78%)`}"
	title={pseudo}
>
	{#if src}
		<img {src} alt="" loading="lazy" />
	{:else}
		{initiales}
	{/if}
</span>

<style>
	/* Anneau clair du podium : il detache l'avatar du fond sombre. */
	.avatar--ring {
		box-shadow: 0 0 0 3px var(--surface-3);
	}
</style>
