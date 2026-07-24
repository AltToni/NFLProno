import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// La verification d'origine CSRF est active par defaut depuis SvelteKit 2 ;
		// derriere un reverse proxy qui reecrit l'origine, ajouter ici
		// `csrf: { trustedOrigins: [PUBLIC_BASE_URL] }`.
		adapter: adapter({ out: 'build' })
	}
};

export default config;
