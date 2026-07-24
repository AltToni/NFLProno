<script lang="ts">
	import LocalTime from '$lib/components/LocalTime.svelte';
	import Countdown from '$lib/components/Countdown.svelte';
	import { GAME_STATUS_LABEL } from '$lib/nfl';

	let { data } = $props();

	const game = $derived(data.game);
	const odds = $derived(data.odds);
	const finished = $derived(game.status === 'final');

	const winner = $derived(
		finished && game.scoreHome !== null && game.scoreAway !== null
			? game.scoreHome > game.scoreAway
				? 'home'
				: game.scoreHome < game.scoreAway
					? 'away'
					: 'draw'
			: null
	);

	const BONUS_LABEL: Record<string, string> = {
		none: '',
		margin: 'ecart exact',
		exact: 'score exact',
		draw: 'match nul'
	};

	function pct(p: number | null | undefined): string {
		return p === null || p === undefined ? '—' : `${Math.round(p * 100)} %`;
	}
</script>

<svelte:head><title>{game.awayAbbr} @ {game.homeAbbr} — Pronos NFL</title></svelte:head>

<p class="small muted">
	<a href="/pronostics?semaine={game.weekId}">← {data.week?.label ?? 'Retour'}</a>
</p>

<div class="card">
	<div class="between wrap">
		<h1 style="margin:0">{game.awayName} @ {game.homeName}</h1>
		{#if game.neutralized}
			<span class="badge badge--locked">{GAME_STATUS_LABEL[game.status] ?? game.status}</span>
		{:else if finished}
			<span class="badge">final</span>
		{:else if game.status === 'in'}
			<span class="badge badge--live">en direct</span>
		{:else}
			<span class="badge badge--open"><Countdown target={game.kickoffUtc} prefix="dans " /></span>
		{/if}
	</div>

	<p class="small muted" style="margin:0.4rem 0 0">
		<LocalTime value={game.kickoffUtc} withDate />
		{#if game.statusDetail}· {game.statusDetail}{/if}
	</p>

	{#if game.scoreHome !== null && game.scoreAway !== null && game.status !== 'scheduled'}
		<div class="center" style="margin-top:1rem">
			<div style="font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums">
				<span class:muted={winner === 'home'}>{game.scoreAway}</span>
				–
				<span class:muted={winner === 'away'}>{game.scoreHome}</span>
			</div>
			<div class="small muted">{game.awayAbbr} — {game.homeAbbr}</div>
		</div>
	{/if}
</div>

<div class="card">
	<h2>Bareme fige</h2>
	{#if odds}
		<div class="kpi-grid">
			<div class="kpi">
				<div class="kpi__label">{game.awayAbbr}</div>
				<div class="kpi__value">{odds.basePointsAway} pts</div>
				<div class="tiny muted">
					{pct(odds.pAway)} de chances{odds.moneylineAway !== null
						? ` · ML ${odds.moneylineAway > 0 ? '+' : ''}${odds.moneylineAway}`
						: ''}
				</div>
			</div>
			<div class="kpi">
				<div class="kpi__label">{game.homeAbbr}</div>
				<div class="kpi__value">{odds.basePointsHome} pts</div>
				<div class="tiny muted">
					{pct(odds.pHome)} de chances{odds.moneylineHome !== null
						? ` · ML ${odds.moneylineHome > 0 ? '+' : ''}${odds.moneylineHome}`
						: ''}
				</div>
			</div>
		</div>
		<p class="tiny muted" style="margin:0.7rem 0 0">
			{#if odds.fallback}
				Cotes indisponibles au snapshot : bareme de repli 50/50.
			{:else}
				Source : {odds.provider ?? 'ESPN'} — probabilites de-viguees.
			{/if}
		</p>
	{:else}
		<p class="muted small">Aucun bareme fige pour ce match.</p>
	{/if}
</div>

<div class="card">
	<h2>Pronostics du groupe</h2>

	{#if !data.locked}
		<p class="muted small">
			Les pronostics des autres joueurs restent masques jusqu'au kickoff.
			<br />Ils apparaitront ici <Countdown target={game.kickoffUtc} prefix="dans " />.
		</p>
	{:else if data.entries.length === 0}
		<p class="muted small">Personne n'a pronostique ce match.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Joueur</th>
						<th>Choix</th>
						<th class="num">Score predit</th>
						<th class="num">Points</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as entry (entry.userId)}
						<tr>
							<td><a href="/joueur/{entry.userId}">{entry.pseudo}</a></td>
							<td>
								<strong>{entry.pickSide === 'home' ? game.homeAbbr : game.awayAbbr}</strong>
								{#if entry.correct === true}
									<span class="badge badge--open">✓</span>
								{:else if entry.correct === false}
									<span class="badge">✗</span>
								{/if}
							</td>
							<td class="num">{entry.scoreAwayPred}–{entry.scoreHomePred}</td>
							<td class="num">
								{#if entry.points !== null}
									<strong>{entry.points}</strong>
									{#if entry.bonusKind && entry.bonusKind !== 'none'}
										<span class="badge badge--upset">{BONUS_LABEL[entry.bonusKind]}</span>
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

		{#if data.missing.length > 0}
			<p class="tiny muted" style="margin-top:0.7rem">
				Sans pronostic (0 point) : {data.missing.map((m) => m.pseudo).join(', ')}
			</p>
		{/if}
	{/if}
</div>
