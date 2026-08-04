<script lang="ts">
	/**
	 * Jeu d'icones inline.
	 *
	 * Dessinees ici plutot que tirees d'une librairie : la CSP n'autorise ni
	 * script ni feuille externe, et une police d'icones imposerait une origine
	 * de plus. Chaque trace est un `path` de la grille 24x24 habituelle.
	 *
	 * Les icones sont decoratives par defaut (`aria-hidden`) : le libelle
	 * visible a cote porte le sens. Passer `label` pour celles qui sont seules.
	 */
	import type { IconName } from '$lib/types';

	let {
		name,
		size = 20,
		label = null,
		filled = false,
		stroke = 1.8
	}: {
		name: IconName;
		size?: number;
		label?: string | null;
		filled?: boolean;
		stroke?: number;
	} = $props();

	/** Traces contours. `filled` ne concerne que les icones de la barre basse. */
	const PATHS: Record<IconName, string> = {
		accueil: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
		ballon: 'M4.5 19.5c-1.5-5 1-12 7-14.5 4-1.7 8-1 8-1s.7 4-1 8c-2.5 6-9.5 8.5-14 7.5Z M9 15l6-6 M10.5 13.5l1.5 1.5 M13 11l1.5 1.5',
		trophee: 'M7 4h10v5a5 5 0 0 1-10 0V4Z M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11 M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11 M12 14v3 M8.5 20h7 M10 17h4v3h-4z',
		stats: 'M5 20V12 M12 20V4 M19 20v-5',
		reglages:
			'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 13.5a7.6 7.6 0 0 0 0-3l1.8-1.3-1.9-3.3-2.1.9a7.6 7.6 0 0 0-2.6-1.5L14.3 3h-4.6l-.3 2.3a7.6 7.6 0 0 0-2.6 1.5l-2.1-.9-1.9 3.3 1.8 1.3a7.6 7.6 0 0 0 0 3l-1.8 1.3 1.9 3.3 2.1-.9a7.6 7.6 0 0 0 2.6 1.5l.3 2.3h4.6l.3-2.3a7.6 7.6 0 0 0 2.6-1.5l2.1.9 1.9-3.3-1.8-1.3Z',
		bouclier: 'M12 3l7.5 3v5.5c0 4.6-3.1 8.4-7.5 9.5-4.4-1.1-7.5-4.9-7.5-9.5V6L12 3Z',
		couronne: 'M4 17.5h16 M4 17.5 3 7l5 3.5L12 4l4 6.5L21 7l-1 10.5',
		check: 'm5 12.5 4.5 4.5L19 7.5',
		croix: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
		calendrier:
			'M4.5 6.5h15v13h-15z M4.5 10.5h15 M8.5 3.5v4 M15.5 3.5v4',
		'chevron-droite': 'm9.5 5.5 6.5 6.5-6.5 6.5',
		'chevron-gauche': 'm14.5 5.5-6.5 6.5 6.5 6.5',
		livre: 'M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5v-12Z M17 7.5h2v12H7.5',
		sortie: 'M14 7.5V5.5h-9v13h9v-2 M10.5 12h9.5 M17 8.5l3.5 3.5-3.5 3.5'
	};
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : 'presentation'}
	aria-hidden={label ? undefined : 'true'}
	aria-label={label ?? undefined}
>
	{#if label}<title>{label}</title>{/if}
	<path d={PATHS[name]} />
</svg>
