<script lang="ts">
	import { formatCountdown } from '$lib/time';

	let { target, prefix = '' }: { target: number; prefix?: string } = $props();

	let nowSec = $state(Math.floor(Date.now() / 1000));

	$effect(() => {
		const id = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(id);
	});

	const remaining = $derived(target - nowSec);
</script>

<span class="tabular">{prefix}{formatCountdown(remaining)}</span>

<style>
	.tabular {
		font-variant-numeric: tabular-nums;
	}
</style>
