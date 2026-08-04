import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// La verification d'origine CSRF est active par defaut depuis SvelteKit 2 ;
		// derriere un reverse proxy qui reecrit l'origine, ajouter ici
		// `csrf: { trustedOrigins: [PUBLIC_BASE_URL] }`.
		adapter: adapter({ out: 'build' }),

		/**
		 * CSP gere par SvelteKit plutot qu'a la main dans les hooks : lui seul
		 * connait les scripts inline qu'il injecte (donnees d'hydratation) et
		 * peut en calculer les hashes. Un CSP ecrit a la main casserait
		 * l'hydratation ou finirait en 'unsafe-inline', ce qui ne protege plus.
		 */
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self'],
				// Les attributs `style="..."` du projet (anneau de progression,
				// teinte d'avatar, ajustements ponctuels), plus le
				// `<div style="display: contents">` de app.html. Un attribut de
				// style ne peut pas executer de script : c'est la concession la
				// moins chere face a une refonte de toutes les vues.
				'style-src-attr': ['unsafe-inline'],
				// Logos d'equipes servis par le CDN d'ESPN.
				'img-src': ['self', 'data:', 'https://a.espncdn.com'],
				'font-src': ['self'],
				// L'application ne parle qu'a elle-meme depuis le navigateur :
				// les appels a ESPN sont faits par le serveur.
				'connect-src': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none'],
				'object-src': ['none']
			}
		}
	}
};

export default config;
