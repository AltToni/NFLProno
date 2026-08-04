<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import MatchRow from '$lib/components/MatchRow.svelte';
	import ProgressRing from '$lib/components/ProgressRing.svelte';
	import { isTestWeek } from '$lib/nfl';
	import { dayKey, depuis, formatDayHeading } from '$lib/time';
	import type { BoardGame } from '$lib/types';

	let { data } = $props();

	const matchs = $derived(data.matchs as BoardGame[]);

	/** Les matchs mis en avant, regroupes par journee comme dans la grille. */
	const journees = $derived.by(() => {
		const map = new Map<string, BoardGame[]>();
		for (const game of matchs) {
			const key = dayKey(game.kickoffUtc);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(game);
		}
		return [...map.entries()].map(([key, games]) => ({
			key,
			heading: formatDayHeading(games[0].kickoffUtc),
			games
		}));
	});

	const taux = $derived(Math.round(data.recap.successRate * 100));
</script>

<svelte:head><title>Accueil — {data.ligue.name}</title></svelte:head>

<section class="hero">
	<h1 class="hero__title">
		Pronos NFL.
		<span>Entre amis.</span>
	</h1>
	<p class="hero__sub">
		Fais tes pronostics, defie tes amis et prouve que tu es le meilleur GM.
	</p>
	<div class="hero__actions">
		<a class="btn btn--primary" href="/pronostics">
			<Icon name="calendrier" size={18} />
			Voir les matchs
		</a>
		<a class="btn" href="/classement">
			<Icon name="trophee" size={18} />
			Voir le classement
		</a>
	</div>
</section>

<div class="grid-home">
	<!-- ---------------------------------------------------------------- -->
	<section class="card">
		{#if data.week}
			<div class="section-head">
				<h2>
					{data.week.label}
					{#if isTestWeek(data.week.testKind)}<span class="badge badge--test">TEST</span>{/if}
				</h2>
				{#if data.ouverts > 0}
					<span class="chip">{data.restants} match{data.restants > 1 ? 's' : ''} restant{data.restants > 1 ? 's' : ''}</span>
				{:else}
					<span class="chip">semaine close</span>
				{/if}
			</div>

			{#if matchs.length > 0}
				<div class="panel">
					{#each journees as journee (journee.key)}
						<div class="jour">{journee.heading}</div>
						<div class="rows">
							{#each journee.games as game (game.id)}
								<MatchRow {game} weekId={data.week.id} />
							{/each}
						</div>
					{/each}
				</div>

				<a class="more-link" href="/pronostics?semaine={data.week.id}">
					Voir tous les matchs
					<Icon name="chevron-droite" size={16} />
				</a>
			{:else}
				<p class="muted small" style="margin:0">Aucun match dans cette semaine.</p>
			{/if}
		{:else}
			<h2>Aucune semaine ouverte</h2>
			<p class="muted small" style="margin:0">
				Les pronostics s'ouvrent chaque <strong>mercredi a 09:00</strong>, des que le bareme de la
				semaine est fige.
			</p>
		{/if}
	</section>

	<!-- ---------------------------------------------------------------- -->
	<section class="card">
		<div class="section-head">
			<h2>Classement</h2>
			<a class="tiny muted" href="/classement">Voir tout</a>
		</div>

		{#if data.classement.length > 0}
			<div class="rows">
				{#each data.classement as row (row.userId)}
					<a
						class="line line--link"
						class:line--moi={row.userId === data.user?.id}
						href="/joueur/{row.userId}"
					>
						<span class="rang num" class:rang--top={row.rank <= 3}>{row.rank}</span>
						<Avatar pseudo={row.pseudo} src={row.avatar} size={30} />
						<span class="grow ellipsis">{row.pseudo}</span>
						<span class="pts small">{row.points} <span class="tiny muted">PTS</span></span>
					</a>
				{/each}
			</div>
			<a class="btn btn--block" href="/classement" style="margin-top:0.8rem">
				Voir le classement complet
			</a>
		{:else}
			<p class="muted small" style="margin:0">Aucun point marque pour l'instant.</p>
		{/if}
	</section>
</div>

<div class="grid-3">
	<!-- ---------------------------------------------------------------- -->
	<section class="card">
		<div class="section-head">
			<h2>Mon recap</h2>
			<a class="tiny muted" href="/joueur/{data.user?.id}">Mes stats</a>
		</div>

		<div class="recap">
			<ProgressRing ratio={data.recap.successRate} valeur={data.recap.weekPoints} />

			<div class="recap__lignes">
				<div class="recap__ligne">
					<span class="muted">{data.week?.label ?? 'Semaine'}</span>
					<span class="pts">{data.recap.weekPoints} PTS</span>
				</div>
				<div class="recap__ligne">
					<span class="muted">Saison</span>
					<strong class="num">{data.recap.seasonPoints} PTS</strong>
				</div>
				<div class="recap__sep"></div>
				<div class="recap__ligne">
					<span class="muted">Bons pronos</span>
					<strong class="num">{data.recap.corrects}</strong>
				</div>
				<div class="recap__ligne">
					<span class="muted">Mauvais pronos</span>
					<strong class="num">{data.recap.wrongs}</strong>
				</div>
				<div class="recap__ligne">
					<span class="muted">Taux de reussite</span>
					<span class="pts">{taux}%</span>
				</div>
			</div>
		</div>
		<p class="tiny muted" style="margin:0.7rem 0 0">
			L'anneau montre le taux de reussite sur la saison ; le nombre au centre, les points de la
			semaine.
		</p>
	</section>

	<!-- ---------------------------------------------------------------- -->
	<section class="card">
		<div class="section-head">
			<h2>Activite recente</h2>
		</div>

		{#if data.activite.length > 0}
			<div class="rows">
				{#each data.activite as a (a.userId + '-' + a.gameId)}
					<div class="line">
						<Avatar pseudo={a.pseudo} src={a.avatar} size={36} />
						<div class="grow" style="min-width:0">
							<div class="small">
								<strong>{a.pseudo}</strong> a pronostique
								{a.awayAbbr} vs {a.homeAbbr}
							</div>
							<div class="tiny muted">{depuis(a.updatedAt)}</div>
						</div>
						{#if a.correct !== null}
							<span
								class="verdict"
								class:verdict--ok={a.correct}
								title={a.correct ? 'Bon pronostic' : 'Mauvais pronostic'}
							>
								<Icon
									name={a.correct ? 'check' : 'croix'}
									size={14}
									stroke={3}
									label={a.correct ? 'Bon pronostic' : 'Mauvais pronostic'}
								/>
							</span>
						{/if}
					</div>
				{/each}
			</div>
			<p class="tiny muted" style="margin:0.7rem 0 0">
				Le contenu d'un pronostic reste cache jusqu'au coup d'envoi : seul le resultat apparait, une
				fois le match termine.
			</p>
		{:else}
			<p class="muted small" style="margin:0">Personne n'a encore pronostique cette saison.</p>
		{/if}
	</section>

	<!-- ---------------------------------------------------------------- -->
	<section class="card ligue">
		<div class="section-head">
			<h2>Ma ligue</h2>
		</div>
		<div class="ligue__corps">
			<span class="ligue__ecu"><Icon name="bouclier" size={44} stroke={1.5} /></span>
			<div class="ligue__nom">{data.ligue.name}</div>
			<div class="muted small">
				{data.ligue.members} membre{data.ligue.members > 1 ? 's' : ''}
			</div>
			{#if data.monRang}
				<!-- Rang et exposant colles : un retour a la ligne entre l'expression
				     et la balise inserait une espace, et « 1 er » se lit mal. -->
				<div class="chip" style="margin-top:0.7rem">
					Tu es <strong>{data.monRang.rank}<sup>{data.monRang.rank === 1 ? 'er' : 'e'}</sup></strong> sur {data.ligue.members}
				</div>
			{/if}
		</div>
		{#if data.user?.role === 'admin'}
			<a class="btn btn--block" href="/admin">
				<Icon name="reglages" size={16} />
				Gerer la ligue
			</a>
		{/if}
	</section>
</div>

<!-- -------------------------------------------------------------------- -->
<section class="card">
	<div class="section-head">
		<h2>Derniers resultats</h2>
		<a class="tiny muted" href="/classement">Voir tous les resultats</a>
	</div>

	{#if data.resultats.length > 0}
		<div class="resultats">
			{#each data.resultats as r (r.gameId)}
				<a class="resultat" href="/match/{r.gameId}">
					<div class="resultat__score">
						<span class="resultat__camp">
							{#if r.awayLogo}<img src={r.awayLogo} alt="" loading="lazy" />{/if}
							<span class="tiny muted">{r.awayAbbr}</span>
						</span>
						<strong class="num">{r.scoreAway}</strong>
						<span class="muted">–</span>
						<strong class="num">{r.scoreHome}</strong>
						<span class="resultat__camp">
							{#if r.homeLogo}<img src={r.homeLogo} alt="" loading="lazy" />{/if}
							<span class="tiny muted">{r.homeAbbr}</span>
						</span>
					</div>
					<div class="tiny muted">{r.weekLabel}</div>
					{#if r.joues > 0}
						<span class="chip chip--positive tiny">
							{r.corrects}/{r.joues} bons pronostics
						</span>
					{:else}
						<span class="chip tiny">aucun pronostic</span>
					{/if}
				</a>
			{/each}
		</div>
	{:else}
		<p class="muted small" style="margin:0">Aucun match termine pour l'instant.</p>
	{/if}
</section>

<style>
	/* --- liste de matchs --- */
	.jour {
		padding: 0.55rem 0.9rem 0.35rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		color: var(--muted-2);
		background: rgba(255, 255, 255, 0.015);
		border-top: 1px solid var(--border);
	}
	.jour:first-child {
		border-top: none;
	}

	/* --- classement condense --- */
	.rang {
		width: 1.5rem;
		text-align: center;
		font-weight: 700;
		color: var(--muted);
		font-size: 0.9rem;
		flex: none;
	}
	.rang--top {
		color: var(--gold);
	}
	.line--moi {
		background: var(--accent-soft);
	}
	.ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		font-size: 0.92rem;
	}

	/* --- recap --- */
	.recap {
		display: flex;
		align-items: center;
		gap: 1.1rem;
	}
	.recap__lignes {
		flex: 1;
		min-width: 0;
	}
	.recap__ligne {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.3rem 0;
		font-size: 0.9rem;
	}
	.recap__sep {
		height: 1px;
		background: var(--border);
		margin: 0.35rem 0;
	}

	@media (max-width: 400px) {
		.recap {
			flex-direction: column;
			gap: 0.6rem;
		}
		.recap__lignes {
			width: 100%;
		}
	}

	/* --- activite --- */
	.verdict {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		flex: none;
		background: var(--danger);
		color: #fff;
	}
	.verdict--ok {
		background: var(--positive-dim);
	}

	/* --- ligue --- */
	.ligue {
		display: flex;
		flex-direction: column;
	}
	.ligue__corps {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0.6rem 0 1.1rem;
	}
	.ligue__ecu {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 76px;
		height: 76px;
		border-radius: 50%;
		margin-bottom: 0.7rem;
		color: var(--upset);
		background: radial-gradient(circle, rgba(124, 107, 240, 0.22) 0%, transparent 70%);
	}
	.ligue__nom {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
	}

	/* --- derniers resultats --- */
	.resultats {
		display: grid;
		gap: 0.6rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 620px) {
		.resultats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 980px) {
		.resultats {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.resultat {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-2);
	}
	.resultat:hover {
		border-color: var(--border-2);
	}
	.resultat__score {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 1.4rem;
		font-family: var(--font-display);
		letter-spacing: -0.02em;
	}
	.resultat__camp {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}
	.resultat__camp img {
		width: 30px;
		height: 30px;
		object-fit: contain;
	}
</style>
