<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';

	let { data, children } = $props();

	const links = $derived(
		[
			{ href: '/pronostics', label: 'Mes pronos' },
			{ href: '/classement', label: 'Classement' },
			{ href: `/joueur/${data.user?.id ?? ''}`, label: 'Mon profil' },
			{ href: '/regles', label: 'Regles' },
			...(data.user?.role === 'admin' ? [{ href: '/admin', label: 'Admin' }] : [])
		].filter((l) => data.user)
	);

	function isCurrent(href: string): boolean {
		const path = $page.url.pathname;
		return path === href || (href !== '/' && path.startsWith(href + '/'));
	}
</script>

<div class="app">
	{#if data.user}
		<nav class="nav">
			<a class="nav__brand" href="/pronostics">🏈 Pronos NFL</a>
			<div class="nav__links">
				{#each links as link (link.href)}
					<a
						class="nav__link"
						href={link.href}
						aria-current={isCurrent(link.href) ? 'page' : undefined}>{link.label}</a
					>
				{/each}
			</div>
			<form method="POST" action="/deconnexion">
				<button class="nav__link" type="submit" style="border:0;background:none;cursor:pointer"
					>Quitter</button
				>
			</form>
		</nav>
	{/if}

	{@render children()}
</div>
