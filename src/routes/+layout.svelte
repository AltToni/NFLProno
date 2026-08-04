<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Avatar from '$lib/components/Avatar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/types';

	let { data, children } = $props();

	interface Entree {
		href: string;
		label: string;
		icone: IconName;
		/** Presente dans la barre basse du mobile. */
		mobile: boolean;
	}

	/**
	 * Une seule liste pour les deux barres : elles doivent designer les memes
	 * pages, seule la forme change. `mobile` decide de la presence dans la barre
	 * basse, limitee a cinq entrees — au-dela les cibles deviennent trop
	 * etroites pour le pouce.
	 */
	const entrees = $derived.by((): Entree[] => {
		if (!data.user) return [];
		const admin = data.user.role === 'admin';
		return [
			{ href: '/', label: 'Accueil', icone: 'accueil', mobile: true },
			{ href: '/pronostics', label: 'Pronostics', icone: 'ballon', mobile: true },
			{ href: '/classement', label: 'Classement', icone: 'trophee', mobile: true },
			{ href: `/joueur/${data.user.id}`, label: 'Stats', icone: 'stats', mobile: true },
			{ href: '/regles', label: 'Regles', icone: 'livre', mobile: false },
			...(admin
				? [{ href: '/admin', label: 'Admin', icone: 'reglages' as IconName, mobile: true }]
				: [])
		];
	});

	const mobiles = $derived(entrees.filter((e) => e.mobile));

	/**
	 * L'accueil est le seul chemin exact : sans ce cas particulier, `/` serait
	 * prefixe de tout et resterait allume sur toutes les pages.
	 */
	function courant(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href + '/');
	}
</script>

<div class="app">
	{#if data.user}
		<nav class="nav" aria-label="Navigation principale">
			<a class="nav__brand" href="/">
				Pronos <span>NFL</span>
			</a>

			<div class="nav__links">
				{#each entrees as entree (entree.href)}
					<a
						class="nav__link"
						href={entree.href}
						aria-current={courant(entree.href) ? 'page' : undefined}
					>
						{entree.label}
					</a>
				{/each}
			</div>

			<div class="nav__compte">
				<!-- Sur mobile la barre du haut n'a plus de liens : l'acces aux regles
				     y reste par cette icone, la barre basse etant reservee aux cinq
				     destinations principales. -->
				<a class="nav__icone nav__icone--mobile" href="/regles" aria-label="Regles du jeu">
					<Icon name="livre" size={19} />
				</a>
				<a class="nav__profil" href="/joueur/{data.user.id}">
					<Avatar pseudo={data.user.pseudo} src={data.user.avatar} size={30} />
					<span class="nav__pseudo">{data.user.pseudo}</span>
				</a>
				<form method="POST" action="/deconnexion">
					<button class="nav__icone" type="submit" aria-label="Se deconnecter" title="Quitter">
						<Icon name="sortie" size={19} />
					</button>
				</form>
			</div>
		</nav>
	{/if}

	{@render children()}
</div>

{#if data.user}
	<nav class="bottom-nav" aria-label="Navigation">
		{#each mobiles as entree (entree.href)}
			{@const actif = courant(entree.href)}
			<a
				class="bottom-nav__item"
				href={entree.href}
				aria-current={actif ? 'page' : undefined}
			>
				<Icon name={entree.icone} size={22} filled={actif && entree.icone === 'accueil'} />
				{entree.label}
			</a>
		{/each}
	</nav>
{/if}

<style>
	.nav__compte {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
	}

	.nav__profil {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.25rem 0.25rem;
		border-radius: 999px;
	}
	.nav__profil:hover {
		background: var(--surface-2);
	}
	.nav__pseudo {
		font-size: 0.9rem;
		font-weight: 600;
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav__icone {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.nav__icone:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.nav__icone--mobile {
		display: none;
	}

	@media (max-width: 859px) {
		.nav__icone--mobile {
			display: inline-flex;
		}
		.nav__pseudo {
			display: none;
		}
	}
</style>
