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
					<td><strong>Vainqueur + ecart</strong><br /><span class="tiny muted">par defaut</span></td>
					<td>une equipe et un ecart de ton choix, ou « Match nul »</td>
					<td>
						<strong class="pts">le bonus de rarete</strong><br />
						de +{f.plancher} % a +{f.plafond} % selon l'ecart vise<br />
						<span class="tiny muted">jamais le ×{f.scoreExact} : aucun score n'est annonce</span>
					</td>
				</tr>
				<tr>
					<td><strong>Score</strong></td>
					<td>les deux scores ; le vainqueur et l'ecart s'en deduisent tout seuls</td>
					<td>
						×{f.ecartExact} ecart exact<br />
						×{f.scoreExact} score exact<br />
						<span class="tiny muted">forfaitaire : pas de bonus de rarete, pas de tolerance</span>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<h3>Le bonus de rarete</h3>
	<p class="small">
		En mode ecart, <strong>plus l'ecart que tu vises est improbable, plus le bonus est gros.</strong>
		Un match gagne de 3 points est le resultat le plus courant du football americain — un panier a la
		derniere seconde — et ne vaut presque rien. Un ecart de 17, ou un match nul, sont rares : ils
		valent cher.
	</p>
	<p class="small muted">
		La frequence de chaque ecart vient des <strong>{data.source.matchs} matchs</strong> de saison
		reguliere joues entre {data.source.depuis} et {data.source.jusqua}. Elle est figee : elle ne
		bougera pas en cours de saison.
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">Ecart vise</th>
					<th class="num">Frequence</th>
					<th class="num">Bonus si exact</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rarete as r (r.ecart)}
					<tr>
						<td class="num">
							{#if r.ecart === 0}Match nul{:else}+{r.ecart}{/if}
						</td>
						<td class="num">{r.frequence} %</td>
						<td class="num"><strong class="pts">+{r.bonus} %</strong></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="tiny muted">
		Le bonus moyen, pondere par la frequence reelle des ecarts, vaut 100 % : le bareme
		<strong>redistribue</strong>, il n'inflate pas. Il est borne entre +{f.plancher} % et
		+{f.plafond} % — au-dela de {data.source.ecartMax} points, tous les ecarts partagent la meme
		frequence, un ecart de 34 n'etant pas plus previsible qu'un de 31.
	</p>

	<h3>Rater son ecart</h3>
	<p class="small">
		Le bonus ne tombe pas d'un coup : tu perds <strong>{f.pas} %</strong> de ce bonus par point
		d'erreur. Le vainqueur, lui, reste acquis — les points de base sont gagnes des que tu as designe
		la bonne equipe.
	</p>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">Erreur sur l'ecart</th>
					<th class="num">Part du bonus conservee</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tolerance as t (t.erreur)}
					<tr>
						<td class="num">{t.erreur === 0 ? 'pile dessus' : `± ${t.erreur}`}</td>
						<td class="num">{t.part} %</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
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
		soit un ecart de <strong>{ex.ecart} points</strong>. Voici ce que rapportent quelques
		pronostics possibles, selon l'ecart annonce et sa rarete.
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
						<td class="tiny muted">{ligne.mode === 'A' ? 'ecart' : 'score'}</td>
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
	<p class="tiny muted">Les points sont arrondis a l'entier.</p>

	<p class="small">
		Les deux premieres lignes disent tout du bonus de rarete : <strong>{ex.homeAbbr} +3</strong> et
		<strong>{ex.homeAbbr} +5</strong> ratent l'ecart reel du meme point, mais +5 est un resultat bien
		plus rare que +3 — et rapporte donc nettement plus, a erreur egale.
	</p>
	<p class="small">
		Les deux modes ne sont pas equivalents non plus : <strong>{ex.homeAbbr} +3</strong> et
		<strong>22–25</strong> annoncent le meme ecart, mais le mode score n'a aucune tolerance — rate
		d'un point, il ne donne rien.
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
