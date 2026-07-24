<script lang="ts">
	import type { EvolutionSeries } from '$lib/types';

	let {
		weeks,
		series,
		highlightUserId = null
	}: {
		weeks: { id: number; label: string }[];
		series: EvolutionSeries[];
		highlightUserId?: number | null;
	} = $props();

	/**
	 * Bump chart : rang du classement general apres chaque semaine.
	 *
	 * Avec 10 a 25 joueurs, attribuer une couleur par serie serait illisible et
	 * indistinguable en vision des couleurs deficiente. L'identite passe donc par
	 * l'etiquette directe et la mise en avant (une seule serie coloree a la fois :
	 * la tienne, ou celle survolee), toutes les autres restant neutres.
	 * Le tableau de classement juste au-dessus fournit la vue chiffree.
	 */

	const W = 760;
	const PAD = { top: 18, right: 104, bottom: 30, left: 34 };

	const playerCount = $derived(series.filter((s) => s.points.length > 0).length);
	const rowH = 22;
	const H = $derived(PAD.top + PAD.bottom + Math.max(1, playerCount - 1) * rowH);

	const stepX = $derived(
		weeks.length > 1 ? (W - PAD.left - PAD.right) / (weeks.length - 1) : 0
	);

	function x(index: number): number {
		return PAD.left + index * stepX;
	}
	function y(rank: number): number {
		return PAD.top + (rank - 1) * rowH;
	}

	const weekIndex = $derived(new Map(weeks.map((w, i) => [w.id, i])));

	interface Drawn {
		userId: number;
		pseudo: string;
		d: string;
		points: { x: number; y: number; rank: number; cumulative: number; index: number }[];
		last: { x: number; y: number; rank: number } | null;
	}

	const drawn = $derived.by<Drawn[]>(() =>
		series
			.filter((s) => s.points.length > 0)
			.map((s) => {
				const pts = s.points
					.filter((p) => weekIndex.has(p.weekId))
					.map((p) => {
						const index = weekIndex.get(p.weekId)!;
						return {
							x: x(index),
							y: y(p.rank),
							rank: p.rank,
							cumulative: p.cumulative,
							index
						};
					});
				return {
					userId: s.userId,
					pseudo: s.pseudo,
					d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
					points: pts,
					last: pts.length ? pts[pts.length - 1] : null
				};
			})
	);

	let hovered = $state<number | null>(null);
	let cursorIndex = $state<number | null>(null);

	const active = $derived(hovered ?? highlightUserId);

	// Etiquettes directes : le joueur mis en avant, plus le podium final.
	const labelled = $derived.by(() => {
		const ids = new Set<number>();
		if (active !== null) ids.add(active);
		for (const d of drawn) {
			if (d.last && d.last.rank <= 3) ids.add(d.userId);
		}
		return ids;
	});

	const tooltip = $derived.by(() => {
		if (active === null || cursorIndex === null) return null;
		const d = drawn.find((s) => s.userId === active);
		if (!d) return null;
		const point = d.points.find((p) => p.index === cursorIndex) ?? d.points[d.points.length - 1];
		if (!point) return null;
		return { pseudo: d.pseudo, point, week: weeks[point.index] };
	});

	function onMove(event: PointerEvent) {
		const target = event.currentTarget as SVGSVGElement;
		const rect = target.getBoundingClientRect();
		const px = ((event.clientX - rect.left) / rect.width) * W;
		if (stepX === 0) {
			cursorIndex = 0;
			return;
		}
		const idx = Math.round((px - PAD.left) / stepX);
		cursorIndex = Math.max(0, Math.min(weeks.length - 1, idx));
	}
</script>

{#if weeks.length === 0 || playerCount === 0}
	<p class="muted small">Le graphe apparaitra des la premiere semaine scoree.</p>
{:else}
	<div class="chart">
		<svg
			viewBox="0 0 {W} {H}"
			role="img"
			aria-label="Evolution du rang au classement general, semaine par semaine"
			onpointermove={onMove}
			onpointerleave={() => {
				cursorIndex = null;
				hovered = null;
			}}
		>
			<!-- grille : une ligne verticale par semaine -->
			{#each weeks as week, i (week.id)}
				<line
					x1={x(i)}
					x2={x(i)}
					y1={PAD.top - 8}
					y2={H - PAD.bottom + 4}
					class="grid"
					class:grid--cursor={cursorIndex === i}
				/>
				<text x={x(i)} y={H - PAD.bottom + 20} class="axis" text-anchor="middle">
					{week.label.replace('Semaine ', 'S')}
				</text>
			{/each}

			<!-- axe des rangs -->
			{#each Array.from({ length: playerCount }, (_, i) => i) as i (i)}
				{#if i === 0 || (i + 1) % 5 === 0}
					<text x={PAD.left - 12} y={y(i + 1) + 4} class="axis" text-anchor="end">{i + 1}</text>
				{/if}
			{/each}

			<!-- series neutres -->
			{#each drawn as line (line.userId)}
				{#if line.userId !== active}
					<path d={line.d} class="serie" />
					<!-- zone de survol elargie : cible ~14 px autour d'un trait de 2 px -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<path
						d={line.d}
						class="hit"
						aria-hidden="true"
						onpointerenter={() => (hovered = line.userId)}
					/>
				{/if}
			{/each}

			<!-- serie mise en avant, dessinee au-dessus -->
			{#each drawn as line (line.userId)}
				{#if line.userId === active}
					<path d={line.d} class="serie serie--active" />
					{#each line.points as p (p.index)}
						<circle cx={p.x} cy={p.y} r="4" class="dot" />
					{/each}
				{/if}
			{/each}

			<!-- etiquettes directes en fin de courbe -->
			{#each drawn as line (line.userId)}
				{#if line.last && labelled.has(line.userId)}
					<text
						x={line.last.x + 10}
						y={line.last.y + 4}
						class="label"
						class:label--active={line.userId === active}
					>
						{line.pseudo}
					</text>
				{/if}
			{/each}
		</svg>

		{#if tooltip}
			<div class="tooltip">
				<strong>{tooltip.pseudo}</strong> — {tooltip.week?.label}
				<br />
				<span class="muted">rang {tooltip.point.rank} · {tooltip.point.cumulative} pts cumules</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.chart {
		position: relative;
		overflow-x: auto;
	}
	svg {
		width: 100%;
		min-width: 520px;
		height: auto;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--border);
		stroke-width: 1;
	}
	.grid--cursor {
		stroke: #4a5265;
	}
	.axis {
		fill: var(--muted);
		font-size: 10px;
	}
	.serie {
		fill: none;
		stroke: #3c4454;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.serie--active {
		stroke: var(--accent);
		stroke-width: 2.5;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		cursor: pointer;
	}
	.dot {
		fill: var(--accent);
		stroke: var(--surface);
		stroke-width: 2;
	}
	.label {
		fill: var(--muted);
		font-size: 11px;
	}
	.label--active {
		fill: var(--text);
		font-weight: 700;
	}
	.tooltip {
		position: absolute;
		top: 0;
		right: 0;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
		font-size: 0.8rem;
		pointer-events: none;
	}
</style>
