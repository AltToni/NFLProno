<script lang="ts">
	import { enhance } from '$app/forms';
	import { depuis, formatDateTime } from '$lib/time';

	let { data, form } = $props();

	// Le mot est affiche a cote de la couleur : la gravite ne doit pas se lire
	// uniquement au vert/orange/rouge.
	const GRAVITE_MOT = { ok: 'ok', attention: 'attention', probleme: 'probleme' };
	const GRAVITE_CLASSE = {
		ok: 'badge--sain',
		attention: 'badge--attention',
		probleme: 'badge--probleme'
	};

	const groups = $derived.by(() => {
		const map = new Map<string, typeof data.settings>();
		for (const setting of data.settings) {
			if (!map.has(setting.group)) map.set(setting.group, []);
			map.get(setting.group)!.push(setting);
		}
		return [...map.entries()];
	});

	const seasonStarted = $derived(data.weeks.some((w) => w.status !== 'a_venir'));

	const preseasonPicks = $derived(
		data.preseasonWeeks.reduce((total, semaine) => total + semaine.picks, 0)
	);

	const orphelinsTotal = $derived(
		data.orphelins.games +
			data.orphelins.picks +
			data.orphelins.scores +
			data.orphelins.odds +
			data.orphelins.adjustments
	);

	const SAUVEGARDE_ORIGINE = {
		interne: 'cron interne',
		nocturne: 'script hote',
		securite: 'avant restauration'
	};

	function taille(octets: number): string {
		return octets >= 1024 * 1024
			? `${(octets / 1024 / 1024).toFixed(1)} Mo`
			: `${Math.round(octets / 1024)} Ko`;
	}
</script>

<svelte:head><title>Admin — Pronos NFL</title></svelte:head>

<h1>Administration</h1>
<p class="small muted">
	Saison {data.season} · <a href="/admin/matchs">corriger un score →</a>
</p>

{#if form?.ok}
	<div class="alert alert--ok small">{form.ok}</div>
{/if}
{#if form?.error}
	<div class="alert alert--error small">{form.error}</div>
{/if}

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>
		Etat du systeme
		<span class="badge {GRAVITE_CLASSE[data.etat.gravite]}">{GRAVITE_MOT[data.etat.gravite]}</span>
	</h2>
	<p class="small muted">
		{data.etat.enSaison
			? 'En saison : les seuils de fraicheur sont actifs.'
			: 'Hors saison : l’absence de snapshot et de poll est normale, elle n’est pas signalee.'}
	</p>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Indicateur</th>
					<th>Etat</th>
					<th>Quand</th>
					<th>Detail</th>
				</tr>
			</thead>
			<tbody>
				{#each data.etat.indicateurs as indicateur (indicateur.cle)}
					<tr>
						<td>{indicateur.libelle}</td>
						<td>
							<span class="badge {GRAVITE_CLASSE[indicateur.gravite]}">
								{GRAVITE_MOT[indicateur.gravite]}
							</span>
						</td>
						<td title={indicateur.horodatage ? formatDateTime(indicateur.horodatage) : ''}>
							{depuis(indicateur.horodatage, data.etat.horodatage)}
						</td>
						<td class="small muted">{indicateur.detail}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if data.etat.erreursCron.length > 0}
		<h3 class="small" style="margin:1rem 0 0.4rem">Echecs non rattrapes</h3>
		<ul class="small">
			{#each data.etat.erreursCron as echec (echec.startedAt + echec.name)}
				<li>
					<strong>{echec.libelle}</strong> — {formatDateTime(echec.startedAt)}
					<div class="muted">{echec.message ?? 'sans message'}</div>
				</li>
			{/each}
		</ul>
		<p class="tiny muted">
			Une tache disparait de cette liste des qu'elle reussit a nouveau : ce qui reste ici n'a
			pas ete rattrape tout seul.
		</p>
	{/if}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Taches planifiees</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Tache</th>
					<th>Planification</th>
					<th>Prochaine</th>
					<th>Derniere execution</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.tasks as task (task.name)}
					<tr>
						<td>
							{task.label}
							{#if task.running}<span class="badge badge--live">en cours</span>{/if}
						</td>
						<td><code class="tiny">{task.pattern}</code></td>
						<td class="tiny">{task.nextRun ? formatDateTime(task.nextRun) : '—'}</td>
						<td class="tiny">
							{#if task.lastRun}
								<span
									class="badge"
									class:badge--open={task.lastRun.status === 'ok'}
									class:badge--live={task.lastRun.status === 'error'}
								>
									{task.lastRun.status}
								</span>
								{formatDateTime(task.lastRun.startedAt)}
								<div class="muted" style="white-space:normal;max-width:32ch">
									{task.lastRun.message ?? ''}
								</div>
							{:else}
								jamais
							{/if}
						</td>
						<td>
							<form method="POST" action="?/tache" use:enhance>
								<input type="hidden" name="name" value={task.name} />
								<button class="btn btn--sm" type="submit" disabled={task.running}>Relancer</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Actions manuelles</h2>
	<div class="stack">
		<form method="POST" action="?/snapshot" use:enhance class="row wrap">
			<span class="small muted">Snapshot des cotes</span>
			<input
				type="number"
				name="week"
				min="1"
				max="22"
				placeholder="semaine"
				style="width:6.5rem"
				aria-label="Numero de semaine"
			/>
			<select name="seasontype" aria-label="Type de saison" style="width:auto">
				<option value="2">Saison reguliere</option>
				<option value="3">Playoffs</option>
				<option value="1">Presaison</option>
			</select>
			<label class="small muted row" style="gap:0.3rem">
				<input type="checkbox" name="force" style="width:auto" /> ecraser le bareme existant
			</label>
			<button class="btn" type="submit">Lancer</button>
		</form>
		<p class="tiny muted" style="margin:0">
			Sans numero, la premiere semaine ESPN dont les matchs sont encore a venir est utilisee.
			« Ecraser » recalcule un bareme deja fige : a n'utiliser qu'avant l'ouverture des pronostics.
			En presaison, ESPN numerote le Hall of Fame 1 et les trois semaines de presaison 2, 3 et 4.
		</p>

		<div class="row wrap">
			<form method="POST" action="?/recalcul" use:enhance>
				<button class="btn" type="submit">Recalculer tous les points</button>
			</form>
			<form method="POST" action="?/cloturer" use:enhance>
				<button class="btn" type="submit">Cloturer les semaines terminees</button>
			</form>
		</div>
		<p class="tiny muted" style="margin:0">
			Le recalcul est idempotent : il reecrit les points a partir des pronostics et du bareme fige.
		</p>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Ajustements de points</h2>
	<p class="small muted" style="margin-top:-0.3rem">
		La seule facon de corriger le total d'un joueur. Les points calcules, eux, ne se modifient pas
		a la main : ils sont reecrits a partir des pronostics a chaque recalcul, et une valeur forcee y
		disparaitrait au premier match termine. Un ajustement vit a cote et s'ajoute au total.
	</p>
	<p class="tiny muted">
		Il compte au classement general, au classement de sa semaine et dans le graphe d'evolution. Il
		n'entre pas dans le taux de reussite ni dans les points par match, qui decrivent des pronostics
		reellement joues. Le motif est affiche aux joueurs.
	</p>

	<h3 style="margin-top:1.2rem">Compenser une absence</h3>
	<form method="POST" action="?/ajustementMoyenne" use:enhance class="row wrap">
		<select name="userId" aria-label="Joueur a compenser" style="width:auto;min-width:9rem">
			{#each data.players as player (player.id)}
				<option value={player.id}>{player.pseudo}</option>
			{/each}
		</select>
		<select name="weekId" aria-label="Semaine concernee" style="width:auto;min-width:11rem">
			{#each data.weeks as week (week.id)}
				<option value={week.id}>{week.label}</option>
			{/each}
		</select>
		<button class="btn btn--primary" type="submit">Donner la moyenne des autres</button>
	</form>
	<p class="tiny muted" style="margin:0.4rem 0 0">
		Moyenne des points marques cette semaine-la par les autres joueurs actifs <strong
			>ayant reellement joue</strong
		> — un second absent a zero ne tire pas le calcul vers le bas. Les ajustements deja poses sont
		exclus de la moyenne, pour qu'une compensation n'en nourrisse pas une autre. Resultat arrondi a
		l'entier le plus proche.
	</p>

	<h3 style="margin-top:1.3rem">Ajustement libre</h3>
	<form method="POST" action="?/ajustement" use:enhance class="row wrap">
		<select name="userId" aria-label="Joueur a ajuster" style="width:auto;min-width:9rem">
			{#each data.players as player (player.id)}
				<option value={player.id}>{player.pseudo}</option>
			{/each}
		</select>
		<select name="weekId" aria-label="Semaine de l'ajustement" style="width:auto;min-width:11rem">
			{#each data.weeks as week (week.id)}
				<option value={week.id}>{week.label}</option>
			{/each}
		</select>
		<input
			type="number"
			name="points"
			step="1"
			placeholder="points"
			style="width:6.5rem"
			required
			aria-label="Points, negatifs autorises"
		/>
		<input
			type="text"
			name="reason"
			placeholder="motif (affiche aux joueurs)"
			maxlength="120"
			style="flex:1;min-width:14rem;text-align:left"
			required
			aria-label="Motif de l'ajustement"
		/>
		<button class="btn" type="submit">Enregistrer</button>
	</form>
	<p class="tiny muted" style="margin:0.4rem 0 0">
		Les points negatifs sont acceptes. Un joueur ne peut porter qu'un ajustement par semaine :
		reprendre la meme paire corrige la valeur au lieu d'en ajouter une seconde.
	</p>

	<h3 style="margin-top:1.3rem">Ajustements en cours</h3>
	{#if data.adjustments.length === 0}
		<p class="small muted" style="margin:0">Aucun. Le classement est entierement calcule.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Joueur</th>
						<th>Semaine</th>
						<th class="num">Points</th>
						<th>Motif</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.adjustments as ajustement (ajustement.id)}
						<tr>
							<td><a href="/joueur/{ajustement.userId}">{ajustement.pseudo}</a></td>
							<td class="small">{ajustement.weekLabel}</td>
							<td class="num">
								<strong>{ajustement.points > 0 ? '+' : ''}{ajustement.points}</strong>
							</td>
							<td class="small muted" style="white-space:normal">
								{ajustement.reason}
								<div class="tiny">
									{formatDateTime(ajustement.createdAt)}
									{ajustement.createdByPseudo ? ` · par ${ajustement.createdByPseudo}` : ''}
								</div>
							</td>
							<td>
								<form method="POST" action="?/supprimerAjustement" use:enhance>
									<input type="hidden" name="id" value={ajustement.id} />
									<button class="btn btn--sm btn--danger" type="submit">Retirer</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Sauvegardes</h2>

	{#if data.restorePending}
		<div class="alert alert--warn small">
			<strong>Une restauration est armee.</strong> Elle sera mise en place au prochain demarrage de
			l'application. Tant que celui-ci n'a pas eu lieu, la base en service est intacte et
			l'operation reste annulable.
			<form method="POST" action="?/annulerRestauration" use:enhance style="margin-top:0.5rem">
				<button class="btn btn--sm" type="submit">Annuler la restauration</button>
			</form>
		</div>
	{/if}

	<p class="small muted" style="margin-top:-0.3rem">
		Deux mecanismes ecrivent ici : le cron interne de l'application (quotidien, meme disque) et le
		script de l'hote (compresse, copie hors machine). Seul le second protege d'une panne disque.
	</p>

	<div class="row wrap" style="margin-bottom:0.9rem">
		<form method="POST" action="?/sauvegarde" use:enhance>
			<button class="btn" type="submit">Sauvegarder maintenant</button>
		</form>
		<a class="btn btn--sm" href="/admin/export?format=csv" download>Export CSV</a>
		<a class="btn btn--sm" href="/admin/export?format=json" download>Export JSON</a>
	</div>
	<p class="tiny muted" style="margin:0 0 1rem">
		L'export est une archive lisible (une ligne par pronostic, ajustements compris), pas une
		sauvegarde : il ne se restaure pas. Pour restaurer, c'est un fichier <code class="tiny">.db</code
		> de la liste ci-dessous.
	</p>

	{#if data.backups.length === 0}
		<p class="small muted" style="margin:0">
			Aucune sauvegarde dans <code class="tiny">BACKUP_DIR</code>. La tache quotidienne en cree une
			a 04:30 ; « Sauvegarder maintenant » en cree une tout de suite.
		</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Fichier</th>
						<th>Origine</th>
						<th class="num">Taille</th>
						<th>Date</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.backups as sauvegarde (sauvegarde.name)}
						<tr>
							<td class="tiny"><code>{sauvegarde.name}</code></td>
							<td class="tiny muted">{SAUVEGARDE_ORIGINE[sauvegarde.kind]}</td>
							<td class="num tiny">{taille(sauvegarde.bytes)}</td>
							<td class="tiny">{formatDateTime(sauvegarde.modifiedAt)}</td>
							<td>
								<a
									class="btn btn--sm"
									href="/admin/sauvegardes?fichier={encodeURIComponent(sauvegarde.name)}"
									download
								>
									Telecharger
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h3 style="margin-top:1.3rem">Restaurer</h3>
		<form method="POST" action="?/restaurer" use:enhance class="row wrap">
			<select name="fichier" aria-label="Sauvegarde a restaurer" style="flex:1;min-width:16rem">
				{#each data.backups as sauvegarde (sauvegarde.name)}
					<option value={sauvegarde.name}>
						{sauvegarde.name} — {formatDateTime(sauvegarde.modifiedAt)}
					</option>
				{/each}
			</select>
			<input
				type="text"
				name="confirmation"
				placeholder="taper oui"
				style="width:7rem"
				required
				aria-label="Confirmation : taper oui"
			/>
			<button class="btn btn--danger" type="submit">Restaurer</button>
		</form>
		<p class="tiny muted" style="margin:0.4rem 0 0">
			Rien n'est detruit par cette action : la sauvegarde est d'abord verifiee
			(<code class="tiny">integrity_check</code>, presence de joueurs, version de schema lisible),
			la base actuelle est copiee dans <code class="tiny">avant-restauration-*.db</code>, puis le
			remplacement est depose en attente. L'application s'arrete alors, et c'est le demarrage
			suivant qui bascule — moment ou plus aucune connexion ne tient la base. En production
			(<code class="tiny">restart: unless-stopped</code>) le conteneur repart seul ; demarree a la
			main, l'application doit etre relancee a la main.
		</p>
	{/if}
</div>

<!-- ------------------------------------------------------------------ -->
{#if data.preseasonWeeks.length > 0}
	<div class="card">
		<h2>Presaison</h2>
		<p class="small muted">
			Les semaines de presaison sont de vraies semaines : verrouillage au kickoff, points calcules,
			et <strong>comptees au classement general</strong>. C'est le galop d'essai d'avant-saison —
			il faut donc le remettre a zero avant la semaine 1, sinon la vraie saison demarre avec ces
			points-la.
		</p>

		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Semaine</th>
						<th class="num">Matchs</th>
						<th class="num">Pronostics</th>
						<th class="num">Points</th>
					</tr>
				</thead>
				<tbody>
					{#each data.preseasonWeeks as semaine (semaine.id)}
						<tr>
							<td>
								<a href="/pronostics?semaine={semaine.id}">{semaine.label}</a>
								<span class="tiny muted">({semaine.status})</span>
							</td>
							<td class="num">{semaine.games}</td>
							<td class="num">{semaine.picks}</td>
							<td class="num">{semaine.scores}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<form method="POST" action="?/purgerPresaison" use:enhance style="margin-top:0.8rem">
			<label class="small muted row" style="gap:0.3rem;margin-bottom:0.5rem">
				<input type="checkbox" name="confirmation" style="width:auto" />
				je confirme l'effacement des {preseasonPicks} pronostic(s) de presaison
			</label>
			<button class="btn btn--danger" type="submit">Remise a zero : effacer la presaison</button>
		</form>
		<p class="tiny muted" style="margin:0.4rem 0 0">
			Supprime les semaines de presaison, leurs matchs, leurs baremes figes, les pronostics et les
			points. Les comptes, les invitations et les reglages du bareme ne sont pas touches.
		</p>
	</div>
{/if}

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Outils de test</h2>
	<p class="small muted">
		Deux facons d'exercer le cycle complet hors saison. Les semaines creees ici portent
		<span class="badge badge--test">TEST</span> partout dans l'interface, sortent du classement
		general et des statistiques des joueurs, et ne deviennent jamais la semaine affichee par
		defaut. Elles restent visibles de tous les joueurs.
	</p>

	<h3 style="margin-top:1.1rem">Rejeu d'une saison passee</h3>
	<form method="POST" action="?/rejeu" use:enhance class="row wrap">
		<input
			type="number"
			name="year"
			min="2000"
			max={data.season - 1}
			value={data.season - 1}
			style="width:6.5rem"
			aria-label="Saison a rejouer"
		/>
		<select name="seasontype" aria-label="Type de saison" style="width:auto">
			<option value="2">Saison reguliere</option>
			<option value="3">Playoffs</option>
		</select>
		<input
			type="number"
			name="week"
			min="1"
			max="22"
			value="1"
			placeholder="semaine"
			style="width:6.5rem"
			aria-label="Numero de semaine"
		/>
		<button class="btn" type="submit">Creer la semaine de rejeu</button>
	</form>
	<p class="tiny muted" style="margin:0.4rem 0 0">
		Les matchs arrivent deja finals et les cotes viennent de l'historique ESPN. Le verrouillage au
		kickoff est neutralise sur ces semaines — sans quoi rien ne serait saisissable — et la cloture
		automatique les ignore. Enchainer ensuite « Recalculer tous les points ».
	</p>

	<h3 style="margin-top:1.3rem">Simulation acceleree</h3>
	{#if data.mockEnabled}
		<form method="POST" action="?/simulation" use:enhance class="row wrap">
			<button class="btn" type="submit">
				Creer {data.nbFixtures} matchs fictifs
			</button>
			<span class="small muted">kickoffs a +5, +10, +15 et +20 min</span>
		</form>
		<p class="tiny muted" style="margin:0.4rem 0 0">
			Le verrouillage, lui, s'applique normalement : c'est ce qu'on vient observer, avec
			l'apparition des pronostics des autres et le calcul des points au passage en final. Les
			scores avancent d'un quart-temps toutes les 2 min 30 ; relancer « Poll des scores » pour les
			faire suivre, ou demarrer avec <code class="tiny">CRON_RESULTS=* * * * *</code>.
		</p>
	{:else}
		<p class="small muted" style="margin:0">
			Indisponible : demarrer l'application avec <code class="tiny">MOCK_ESPN=1</code>. Sans cette
			variable, aucun match fictif ne peut entrer en base.
		</p>
	{/if}

	<h3 style="margin-top:1.3rem">Semaines de test en base</h3>
	{#if data.testWeeks.length === 0}
		<p class="small muted" style="margin:0">Aucune.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Semaine</th>
						<th>Nature</th>
						<th class="num">Matchs</th>
						<th class="num">Pronos</th>
						<th class="num">Points</th>
					</tr>
				</thead>
				<tbody>
					{#each data.testWeeks as semaine (semaine.id)}
						<tr>
							<td>
								<a href="/pronostics?semaine={semaine.id}">{semaine.label}</a>
								<span class="tiny muted">({semaine.status})</span>
							</td>
							<td class="small">
								{semaine.testKind === 'rejeu'
									? `rejeu de ${semaine.sourceSeason} / type ${semaine.sourceSeasontype} / semaine ${semaine.sourceNumber}`
									: 'simulation'}
							</td>
							<td class="num">{semaine.games}</td>
							<td class="num">{semaine.picks}</td>
							<td class="num">{semaine.scores}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<form method="POST" action="?/purgerTests" use:enhance style="margin-top:0.8rem">
			<button class="btn btn--danger" type="submit">Supprimer les semaines TEST</button>
		</form>
		<p class="tiny muted" style="margin:0.4rem 0 0">
			Supprime les semaines marquees et tout ce qui en depend : points, pronostics, baremes figes,
			matchs. Les vraies semaines ne sont pas touchees, et le controle d'orphelins est refait
			juste apres.
		</p>
	{/if}

	{#if orphelinsTotal > 0}
		<div class="alert alert--error small" style="margin:0.9rem 0 0">
			{orphelinsTotal} ligne(s) orpheline(s) en base : {data.orphelins.games} match(s),
			{data.orphelins.picks} pronostic(s), {data.orphelins.scores} ligne(s) de points,
			{data.orphelins.odds} bareme(s), {data.orphelins.adjustments} ajustement(s) sans parent.
		</div>
	{/if}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Invitations</h2>
	<form method="POST" action="?/inviter" use:enhance class="row wrap" style="margin-bottom:0.9rem">
		<input
			type="email"
			name="email"
			placeholder="email (optionnel, rend le code nominatif)"
			style="flex:1;min-width:14rem;text-align:left"
			aria-label="Email de l'invite"
		/>
		<input
			type="text"
			name="note"
			placeholder="note"
			style="width:9rem;text-align:left"
			aria-label="Note"
		/>
		<input
			type="number"
			name="ttlDays"
			placeholder="jours"
			min="1"
			max="365"
			style="width:6rem"
			aria-label="Validite en jours"
		/>
		<button class="btn btn--primary" type="submit">Creer un code</button>
	</form>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Code</th>
					<th>Reserve a</th>
					<th>Statut</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.invites as invite (invite.id)}
					<tr>
						<td><code>{invite.code}</code></td>
						<td class="small muted">{invite.email ?? 'libre'}{invite.note ? ` · ${invite.note}` : ''}</td>
						<td class="small">
							{#if invite.usedAt}
								<span class="badge">utilise le {formatDateTime(invite.usedAt)}</span>
							{:else if invite.expiresAt && invite.expiresAt * 1000 < Date.now()}
								<span class="badge badge--locked">expire</span>
							{:else}
								<span class="badge badge--open">
									valide{invite.expiresAt ? ` jusqu'au ${formatDateTime(invite.expiresAt)}` : ''}
								</span>
							{/if}
						</td>
						<td>
							{#if !invite.usedAt}
								<form method="POST" action="?/supprimerInvite" use:enhance>
									<input type="hidden" name="id" value={invite.id} />
									<button class="btn btn--sm btn--danger" type="submit">Supprimer</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
				{#if data.invites.length === 0}
					<tr><td colspan="4" class="muted small">Aucune invitation.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Joueurs</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Pseudo</th>
					<th>Email</th>
					<th>Role</th>
					<th>Etat</th>
				</tr>
			</thead>
			<tbody>
				{#each data.players as player (player.id)}
					<tr>
						<td><a href="/joueur/{player.id}">{player.pseudo}</a></td>
						<td class="small muted">{player.email}</td>
						<td>
							<form method="POST" action="?/role" use:enhance class="row">
								<input type="hidden" name="id" value={player.id} />
								<input type="hidden" name="role" value={player.role === 'admin' ? 'joueur' : 'admin'} />
								<span class="badge">{player.role}</span>
								<button class="btn btn--sm" type="submit">
									{player.role === 'admin' ? 'retirer admin' : 'promouvoir'}
								</button>
							</form>
						</td>
						<td>
							<form method="POST" action="?/activer" use:enhance>
								<input type="hidden" name="id" value={player.id} />
								<button class="btn btn--sm" type="submit">
									{player.active === 1 ? 'desactiver' : 'reactiver'}
								</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Ma ligue</h2>
	<p class="small muted" style="margin-top:-0.3rem">
		Le nom affiche sur l'accueil. Le jeu n'a qu'une ligue : tous les comptes actifs en sont membres,
		il n'y a rien a creer ni a rejoindre.
	</p>
	<form method="POST" action="?/ligue" use:enhance class="row wrap">
		<label class="small" for="league-name">Nom</label>
		<input
			id="league-name"
			type="text"
			name="name"
			value={data.leagueName}
			maxlength="40"
			style="width:auto;min-width:14rem;text-align:left"
		/>
		<button class="btn btn--sm" type="submit">Renommer</button>
	</form>
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Reglages du bareme</h2>
	{#if seasonStarted}
		<div class="alert alert--warn small">
			La saison a commence. Modifier une constante ne change pas les baremes deja figes ; relance le
			recalcul des points pour appliquer les nouvelles valeurs aux matchs deja joues.
		</div>
	{/if}

	{#each groups as [group, items] (group)}
		<h3 style="margin-top:1rem">{group}</h3>
		{#each items as setting (setting.key)}
			<form method="POST" action="?/reglage" use:enhance class="between wrap" style="padding:0.35rem 0">
				<label class="small grow" for="set-{setting.key}">
					{setting.label}
					<div class="tiny muted"><code>{setting.key}</code></div>
				</label>
				<input type="hidden" name="key" value={setting.key} />
				<input
					id="set-{setting.key}"
					type="number"
					name="value"
					value={setting.current}
					min={setting.min}
					max={setting.max}
					step={setting.step}
					style="width:7rem"
				/>
				<button class="btn btn--sm" type="submit">OK</button>
			</form>
		{/each}
	{/each}
</div>

<!-- ------------------------------------------------------------------ -->
<div class="card">
	<h2>Journal des taches</h2>
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Quand</th>
					<th>Tache</th>
					<th>Statut</th>
					<th>Message</th>
				</tr>
			</thead>
			<tbody>
				{#each data.runs as run (run.id)}
					<tr>
						<td class="tiny">{formatDateTime(run.startedAt)}</td>
						<td class="small">{run.name} <span class="tiny muted">({run.trigger})</span></td>
						<td>
							<span
								class="badge"
								class:badge--open={run.status === 'ok'}
								class:badge--live={run.status === 'error'}>{run.status}</span
							>
						</td>
						<td class="tiny muted" style="white-space:normal">{run.message ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
