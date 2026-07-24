import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	/**
	 * Le code serveur lit `process.env` directement (en production, docker-compose
	 * fournit les variables via `env_file`). Vite, lui, ne peuple pas
	 * `process.env` a partir de `.env` : sans ce pont, `npm run dev` ignorerait
	 * silencieusement AUTH_SECRET, ADMIN_EMAIL, CRON_ENABLED et le reste.
	 * Les variables reelles de l'environnement restent prioritaires.
	 */
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		if (process.env[key] === undefined) process.env[key] = value;
	}

	return {
		plugins: [sveltekit()],
		// better-sqlite3 est un module natif : il ne doit jamais etre pre-bundle par Vite.
		optimizeDeps: { exclude: ['better-sqlite3'] },
		ssr: { external: ['better-sqlite3'] },
		test: {
			include: ['src/**/*.test.ts']
		}
	};
});
