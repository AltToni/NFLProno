import { defineConfig } from 'vite';

/**
 * Configuration minimale pour les scripts one-shot lances avec `vite-node`.
 *
 * La config principale charge le plugin SvelteKit, qui restreint l'acces
 * disque a `src/` : un script pose dans `scripts/` n'y est pas servi. Ici, pas
 * de plugin — les scripts n'importent que du TypeScript ordinaire du dossier
 * `src/lib/server`, sans alias `$lib` ni composant Svelte.
 */
export default defineConfig({
	root: '.',
	server: { fs: { allow: ['.'] } }
});
