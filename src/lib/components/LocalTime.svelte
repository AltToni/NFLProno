<script lang="ts">
	import { APP_TIMEZONE, formatTime, formatDateTime } from '$lib/time';

	let {
		value,
		withDate = false
	}: {
		value: number;
		withDate?: boolean;
	} = $props();

	// Rendu serveur en heure belge, puis bascule sur le fuseau du navigateur
	// apres hydratation (spec 7) — evite tout ecart de rendu a l'hydratation.
	let tz = $state<string | undefined>(APP_TIMEZONE);
	$effect(() => {
		tz = undefined;
	});
</script>

<span>{withDate ? formatDateTime(value, tz) : formatTime(value, tz)}</span>
