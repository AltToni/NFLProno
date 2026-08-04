<script lang="ts">
	import type { StandingRow } from '$lib/types';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Podium des trois premiers.
	 *
	 * L'ordre visuel n'est pas l'ordre du classement : 2 - 1 - 3, le premier au
	 * centre et sur la marche haute. L'ordre du DOM, lui, reste 1 - 2 - 3 pour
	 * qu'un lecteur d'ecran annonce le classement dans le bon sens ; c'est
	 * `order` qui replace les colonnes.
	 */
	let { rows, moi = null }: { rows: StandingRow[]; moi?: number | null } = $props();

	const top = $derived(rows.slice(0, 3));
	const MEDAILLE = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];
</script>

<div class="podium">
	{#each top as row, i (row.userId)}
		<div
			class="podium__place"
			class:podium__place--premier={i === 0}
			class:podium__place--moi={row.userId === moi}
			style="order:{[2, 1, 3][i]}"
		>
			{#if i === 0}
				<div class="podium__couronne" style="color:var(--gold)">
					<Icon name="couronne" size={30} filled stroke={1.4} />
				</div>
			{/if}

			<div class="podium__avatar">
				<Avatar pseudo={row.pseudo} src={row.avatar} size={i === 0 ? 74 : 58} ring />
				<span class="podium__rang" style="background:{MEDAILLE[i]}">{row.rank}</span>
			</div>

			<div class="podium__nom">{row.pseudo}</div>
			<div class="pts podium__pts">{row.points} PTS</div>
		</div>
	{/each}
</div>

<style>
	/*
	 * Le podium garde sa largeur propre et reste centre : etale sur toute la
	 * largeur d'un ecran de bureau, il perdrait la lecture en un coup d'oeil
	 * qui est toute sa raison d'etre.
	 */
	.podium {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 0.6rem;
		max-width: 32rem;
		margin-inline: auto;
		padding: 2.4rem 1rem 0;
		background:
			radial-gradient(70% 90% at 50% 0%, rgba(244, 176, 4, 0.13) 0%, transparent 60%),
			linear-gradient(180deg, #0d1726 0%, var(--surface) 100%);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 0.85rem;
	}

	.podium__place {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1rem 0.4rem 1.1rem;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid var(--border);
		border-bottom: none;
	}
	/* La marche du premier est plus haute — c'est ce qui fait le podium. */
	.podium__place--premier {
		padding-top: 2.6rem;
		padding-bottom: 1.7rem;
		background: linear-gradient(180deg, rgba(43, 82, 236, 0.18) 0%, rgba(255, 255, 255, 0.02) 65%);
	}
	.podium__place--moi {
		border-color: var(--accent);
	}

	.podium__couronne {
		position: absolute;
		top: -1.5rem;
		filter: drop-shadow(0 0 10px rgba(244, 176, 4, 0.5));
	}

	.podium__avatar {
		position: relative;
		display: flex;
	}
	.podium__rang {
		position: absolute;
		bottom: -6px;
		left: 50%;
		transform: translateX(-50%);
		min-width: 22px;
		height: 22px;
		padding: 0 5px;
		border-radius: 999px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 800;
		font-family: var(--font-display);
		color: #10131a;
		border: 2px solid var(--surface);
	}

	.podium__nom {
		margin-top: 0.45rem;
		font-weight: 600;
		font-size: 0.92rem;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.podium__pts {
		font-size: 0.85rem;
	}

	@media (max-width: 380px) {
		.podium {
			gap: 0.25rem;
			padding-top: 2rem;
		}
		.podium__nom {
			font-size: 0.82rem;
		}
	}
</style>
