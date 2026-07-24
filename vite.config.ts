import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// better-sqlite3 est un module natif : il ne doit jamais etre pre-bundle par Vite.
	optimizeDeps: { exclude: ['better-sqlite3'] },
	ssr: { external: ['better-sqlite3'] },
	test: {
		include: ['src/**/*.test.ts']
	}
});
