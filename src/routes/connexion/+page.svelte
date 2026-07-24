<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let mode = $state<'lien' | 'inscription'>('lien');
</script>

<svelte:head><title>Connexion — Pronos NFL</title></svelte:head>

<div style="max-width:420px;margin:3rem auto 0">
	<h1 class="center">🏈 Pronos NFL</h1>
	<p class="muted center small" style="margin-bottom:1.5rem">
		Pas de mot de passe : tu recois un lien de connexion par email.
	</p>

	<div class="tabs" style="justify-content:center">
		<button class="tab" class:tab--active={mode === 'lien'} onclick={() => (mode = 'lien')}>
			J'ai deja un compte
		</button>
		<button
			class="tab"
			class:tab--active={mode === 'inscription'}
			onclick={() => (mode = 'inscription')}
		>
			J'ai un code d'invitation
		</button>
	</div>

	{#if form?.error}
		<div class="alert alert--error">{form.error}</div>
	{/if}
	{#if form?.success}
		<div class="alert alert--ok">{form.success}</div>
	{/if}
	{#if !data.mailConfigured}
		<div class="alert alert--warn small">
			SMTP non configure : le lien de connexion est ecrit dans les logs du serveur.
		</div>
	{/if}

	<div class="card">
		{#if mode === 'lien'}
			<form method="POST" action="?/lien" use:enhance class="stack">
				<label class="small muted" for="email-lien">Adresse email</label>
				<input
					id="email-lien"
					name="email"
					type="email"
					required
					autocomplete="email"
					placeholder="toi@exemple.be"
					value={form?.email ?? ''}
					style="text-align:left"
				/>
				<button class="btn btn--primary" style="width:100%" type="submit">
					Recevoir mon lien
				</button>
			</form>
		{:else}
			<form method="POST" action="?/inscription" use:enhance class="stack">
				<label class="small muted" for="code">Code d'invitation</label>
				<input
					id="code"
					name="code"
					type="text"
					required
					placeholder="ABCD-EFGH-JKLM"
					value={form?.code ?? ''}
					style="text-transform:uppercase;letter-spacing:0.08em"
				/>

				<label class="small muted" for="pseudo">Pseudo (visible par le groupe)</label>
				<input
					id="pseudo"
					name="pseudo"
					type="text"
					required
					maxlength="24"
					value={form?.pseudo ?? ''}
					style="text-align:left"
				/>

				<label class="small muted" for="email-inscr">Adresse email</label>
				<input
					id="email-inscr"
					name="email"
					type="email"
					required
					autocomplete="email"
					value={form?.email ?? ''}
					style="text-align:left"
				/>

				<button class="btn btn--primary" style="width:100%" type="submit">
					Creer mon compte
				</button>
			</form>
		{/if}
	</div>
</div>
