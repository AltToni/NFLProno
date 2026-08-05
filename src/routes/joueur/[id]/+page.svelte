<script lang="ts">
	import LocalTime from '$lib/components/LocalTime.svelte';
	import { BONUS_LABEL, bonusApplique, PICK_MODE_LABEL, pickLabel } from '$lib/nfl';
	import { stakePoints } from '$lib/scoring';

	let { data } = $props();

	function percent(value: number): string {
		return `${Math.round(value * 100)} %`;
	}

	/** Equipe choisie, ou « Nul » pour un nul predit sans equipe (mode ecart). */
	function pickedTeam(row: (typeof data.history)[number]): string {
		if (row.pickSide === 'home') return row.homeAbbr;
		if (row.pickSide === 'away') return row.awayAbbr;
		return 'Nul';
	}

	/** Enjeu du camp choisi ; moyenne des deux baremes pour un nul predit. */
	function stake(row: (typeof data.history)[number]): string {
		if (row.basePointsHome === null || row.basePointsAway === null) return '—';
		return `${stakePoints(row.pickSide, row)} pts en jeu`;
	}
</script>

<svelte:head><title>{data.player.pseudo} — Pronos NFL</title></svelte:head>

<div class="between wrap">
	<h1>{data.player.pseudo}</h1>
	{#if data.rank}
		<span class="badge badge--open">{data.rank.rank}<sup>e</sup> / {data.total}</span>
	{/if}
</div>

<div class="card">
	<div class="kpi-grid">
		<div class="kpi">
			<div class="kpi__label">Points</div>
			<div class="kpi__value">{data.stats.points}</div>
		</div>
		<div class="kpi">
			<div class="kpi__label">Taux de reussite</div>
			<div class="kpi__value">
				{data.stats.played > 0 ? percent(data.stats.successRate) : '—'}
			</div>
			<div class="tiny muted">{data.stats.corrects}/{data.stats.played} matchs</div>
		</div>
		<div class="kpi">
			<div class="kpi__label">Points / match</div>
			<div class="kpi__value">
				{data.stats.played > 0 ? data.stats.averagePoints.toFixed(1) : '—'}
			</div>
		</div>
		<div class="kpi">
			<div class="kpi__label">Scores exacts</div>
			<div class="kpi__value">{data.stats.exactScores}</div>
			<div class="tiny muted">{data.stats.exactMargins} ecarts exacts</div>
		</div>
		<div class="kpi">
			<div class="kpi__label">Semaines gagnees</div>
			<div class="kpi__value">{data.stats.weeklyWins}</div>
		</div>
	</div>

	{#if data.stats.bestUpset}
		<div class="alert" style="margin:0.9rem 0 0">
			<span class="badge badge--upset">plus gros upset</span>
			<strong>{data.stats.bestUpset.label}</strong> — {data.stats.bestUpset.points} pts, donne a
			{Math.round(data.stats.bestUpset.probability * 100)} % de chances au snapshot.
		</div>
	{/if}
</div>

<div class="card">
	<h2>Historique</h2>
	{#if data.history.length === 0}
		<p class="muted small">Aucun pronostic enregistre pour l'instant.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Semaine</th>
						<th>Match</th>
						<th>Choix</th>
						<th class="num">Prono</th>
						<th class="num">Resultat</th>
						<th class="num">Points</th>
					</tr>
				</thead>
				<tbody>
					{#each data.history as row (row.gameId)}
						<tr>
							<td class="small muted">{row.weekLabel}</td>
							<td>
								<a href="/match/{row.gameId}">{row.awayAbbr} @ {row.homeAbbr}</a>
								<div class="tiny muted"><LocalTime value={row.kickoffUtc} /></div>
							</td>
							<td>
								<strong>{pickedTeam(row)}</strong>
								<div class="tiny muted">{stake(row)}</div>
							</td>
							<td class="num" title={PICK_MODE_LABEL[row.mode as 'score' | 'margin']}>
								{pickLabel(row, row.homeAbbr, row.awayAbbr)}
							</td>
							<td class="num">
								{row.status === 'final' ? `${row.scoreAway}–${row.scoreHome}` : '—'}
							</td>
							<td class="num">
								{#if row.points !== null}
									<strong>{row.points}</strong>
									{@const bonus = bonusApplique(row.basePoints, row.bonusPoints)}
									{#if bonus !== null}
										<div class="tiny muted">
											{row.basePoints} × (1 + {Math.round(bonus * 100)} %)
											{#if row.bonusKind && row.bonusKind !== 'none'}
												· {BONUS_LABEL[row.bonusKind]}
											{/if}
										</div>
									{:else if row.bonusKind && row.bonusKind !== 'none'}
										<div class="tiny muted">{BONUS_LABEL[row.bonusKind]}</div>
									{/if}
								{:else}
									—
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
