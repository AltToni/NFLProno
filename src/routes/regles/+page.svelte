<script lang="ts">
	let { data } = $props();

	const ex = $derived(data.exemple);
	const f = $derived(data.facteurs);
</script>

<svelte:head><title>Comment marquer des points — Pronos NFL</title></svelte:head>

<h1>Comment marquer des points</h1>
<p class="small muted" style="margin-top:-0.4rem">
	Tous les nombres de cette page sortent du moteur de calcul, avec le bareme
	reellement en vigueur. Si l'administrateur change une constante, l'exemple suit.
</p>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>1. Chaque match a son enjeu</h2>
	<p>
		Un match gagne d'avance ne rapporte pas autant qu'une surprise. Les points en jeu sont donc
		calcules a partir des cotes des bookmakers : <strong>plus une equipe est donnee perdante,
		plus la miser rapporte.</strong>
	</p>
	<p class="small">
		Les cotes americaines sont converties en probabilite de victoire, la marge du bookmaker est
		retiree, et le reste est une division :
	</p>
	<pre class="formule">points de base = {data.cfg.k} / probabilite de victoire</pre>
	<p class="small muted">
		Borne entre <strong>{data.cfg.baseMin}</strong> et <strong>{data.cfg.baseMax}</strong> points,
		pour qu'aucun match ne decide a lui seul d'une saison.
	</p>
	<p class="small">
		Ce bareme est <strong>fige le mercredi</strong>, au moment ou la grille s'ouvre. Les cotes
		peuvent bouger ensuite, les points affiches sur ta carte, non : tout le monde joue le meme.
	</p>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>2. Deux facons de pronostiquer</h2>
	<p class="small">
		Le choix se fait <strong>match par match</strong>, avec la bascule en haut de chaque carte.
		Deux matchs de la meme semaine peuvent etre saisis differemment.
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Mode</th>
					<th>Ce que tu saisis</th>
					<th>Bonus atteignables</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><strong>Vainqueur + split</strong><br /><span class="tiny muted">par defaut</span></td>
					<td>
						une equipe, et un ecart parmi
						<span class="tiny">{data.splits.map((s) => `+${s}`).join(' ')}</span> —
						ou « Match nul »
					</td>
					<td>
						×{f.ecartExact} split exact<br />
						×{f.proximite} split rate d'un point<br />
						<span class="tiny muted">jamais le ×{f.scoreExact} : aucun score n'est annonce</span>
					</td>
				</tr>
				<tr>
					<td><strong>Score</strong></td>
					<td>les deux scores ; le vainqueur et l'ecart s'en deduisent tout seuls</td>
					<td>
						×{f.ecartExact} ecart exact<br />
						×{f.scoreExact} score exact<br />
						<span class="tiny muted">pas de bonus de proximite</span>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<h3>Pourquoi seulement huit splits</h3>
	<p class="small">
		Les huit valeurs sont espacees de 3 points, et ce n'est pas un detail d'affichage : tout ecart
		reel entre 2 et 25 est a distance 0 ou 1 d'<strong>exactement un</strong> split. Il y a donc
		toujours un seul bon choix, et jamais deux reponses defendables.
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">Ecart reel</th>
					<th>Le split qui rapporte</th>
					<th class="num">Bonus</th>
				</tr>
			</thead>
			<tbody>
				{#each data.proximite as p (p.reel)}
					<tr>
						<td class="num">{p.reel}</td>
						<td>
							{#if p.exact !== null}
								<strong>+{p.exact}</strong> — pile dessus
							{:else if p.proche !== null}
								<strong>+{p.proche}</strong> — a un point
							{:else}
								aucun
							{/if}
						</td>
						<td class="num">
							{#if p.exact !== null}
								×{f.ecartExact}
							{:else if p.proche !== null}
								×{f.proximite}
							{:else}
								—
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="tiny muted">
		Le bonus de proximite vaut {f.partProximite} fois le bonus plein. Consequence assumee : un match
		gagne d'un seul point (21–20) ne rapporte aucun bonus en mode split, le premier choix etant a
		deux points de la. C'est la contrepartie de la liste fermee — en mode score, on peut annoncer
		n'importe quel ecart, mais il faut alors le viser juste.
	</p>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>3. L'exemple complet</h2>
	<p class="small">
		<strong>{ex.awayAbbr} @ {ex.homeAbbr}.</strong> Les bookmakers donnent {ex.homeAbbr} vainqueur a
		{ex.pHome} %, {ex.awayAbbr} a {ex.pAway} %. L'enjeu de la carte est donc :
	</p>

	<div class="row wrap" style="gap:0.6rem;margin-bottom:0.8rem">
		<div class="enjeu">
			<div class="enjeu__abbr">{ex.awayAbbr}</div>
			<div class="enjeu__pts">{ex.basePointsAway} pts</div>
			<div class="tiny muted">{data.cfg.k} / 0,{ex.pAway}</div>
		</div>
		<div class="enjeu">
			<div class="enjeu__abbr">{ex.homeAbbr}</div>
			<div class="enjeu__pts">{ex.basePointsHome} pts</div>
			<div class="tiny muted">{data.cfg.k} / 0,{ex.pHome}</div>
		</div>
	</div>

	<p class="small">
		Le match se termine <strong>{ex.homeAbbr} {ex.scoreHome} – {ex.awayAbbr} {ex.scoreAway}</strong>,
		soit un ecart de <strong>{ex.ecart} points</strong>. Cet ecart n'est pas un split jouable : le
		seul choix qui rapporte quelque chose en mode split est celui a un point de la.
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Pronostic saisi</th>
					<th>Mode</th>
					<th class="num">Points</th>
					<th>Pourquoi</th>
				</tr>
			</thead>
			<tbody>
				{#each ex.lignes as ligne (ligne.saisi)}
					<tr>
						<td><strong>{ligne.saisi}</strong></td>
						<td class="tiny muted">{ligne.mode === 'A' ? 'split' : 'score'}</td>
						<td class="num">
							<strong>{ligne.points}</strong>
							{#if ligne.facteur}
								<div class="tiny muted">{ligne.enjeu} × {ligne.facteur}</div>
							{/if}
						</td>
						<td class="small">{ligne.pourquoi}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="tiny muted">
		Les points sont arrondis a l'entier : {ex.basePointsHome} × {f.proximite} donne
		{ex.lignes[0].points}.
	</p>

	<p class="small">
		Les deux modes ne sont pas equivalents, et les lignes
		<strong>{ex.homeAbbr} +3</strong> et <strong>22–25</strong> le montrent : le meme ecart annonce
		vaut le bonus de proximite en mode split, et rien du tout en mode score.
	</p>

	<h3>Si ce match avait fini {ex.nul.scoreHome} – {ex.nul.scoreAway}</h3>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Pronostic saisi</th>
					<th class="num">Points</th>
					<th>Pourquoi</th>
				</tr>
			</thead>
			<tbody>
				{#each ex.nul.lignes as ligne (ligne.saisi)}
					<tr>
						<td><strong>{ligne.saisi}</strong></td>
						<td class="num">
							<strong>{ligne.points}</strong>
							{#if ligne.facteur}
								<div class="tiny muted">{ligne.enjeu} × {ligne.facteur}</div>
							{/if}
						</td>
						<td class="small">{ligne.pourquoi}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="tiny muted">
		« Match nul » ne designe aucune equipe : aucun des deux baremes ne s'impose, l'enjeu retenu est
		la moyenne des deux ({ex.enjeuNul} pts ici).
	</p>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>4. Le reste des cas</h2>
	<div class="table-wrap">
		<table>
			<tbody>
				<tr><td>Mauvais vainqueur</td><td class="num"><strong>0</strong></td></tr>
				<tr><td>Pas de pronostic</td><td class="num"><strong>0</strong></td></tr>
				<tr>
					<td>Match nul, alors que tu avais choisi une equipe</td>
					<td class="num"><strong>×{f.nul}</strong> de son enjeu</td>
				</tr>
				<tr><td>Match reporte ou annule</td><td class="num">0 pour tout le monde</td></tr>
				<tr>
					<td>Cotes indisponibles au moment de figer le bareme</td>
					<td class="num">50 / 50 des deux cotes</td>
				</tr>
			</tbody>
		</table>
	</div>
	<p class="small muted">
		Il n'y a <strong>jamais de points negatifs</strong> : un pronostic rate coute ce qu'il aurait pu
		rapporter, rien de plus. Et le classement se joue au cumul, donc les gros matchs a 100+ points
		pesent lourd — mais seulement si tu les joues.
	</p>

	{#if data.cfg.playoffsEnabled}
		<h3>Playoffs</h3>
		<p class="small">
			Les points sont multiplies selon le tour : Wild Card ×{data.cfg.playoffMultipliers[1]},
			Divisional ×{data.cfg.playoffMultipliers[2]}, finales de conference
			×{data.cfg.playoffMultipliers[3]}, Super Bowl ×{data.cfg.playoffMultipliers[5]}.
		</p>
	{/if}
</div>

<p class="center" style="margin:1.2rem 0 2rem">
	<a class="btn btn--primary" href="/pronostics">Aller a ma grille</a>
</p>

<style>
	h3 {
		font-size: 1rem;
		margin: 1.3rem 0 0.5rem;
	}

	.formule {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
		margin: 0.6rem 0;
		font-size: 0.9rem;
		overflow-x: auto;
	}

	.enjeu {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.55rem 0.9rem;
		text-align: center;
		min-width: 7rem;
	}

	.enjeu__abbr {
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.enjeu__pts {
		color: var(--accent);
		font-weight: 700;
	}

	/**
	 * Les tableaux du site portent des libelles courts et interdisent le retour
	 * a la ligne. Ici les cellules sont des phrases : sans cette exception, la
	 * page defilerait lateralement sur telephone au lieu de se replier.
	 */
	td {
		vertical-align: top;
		white-space: normal;
	}

	td.num {
		white-space: nowrap;
	}
</style>
