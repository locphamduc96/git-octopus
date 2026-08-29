import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

// Kept apart from vite.config.ts: the build config points its outDir into the extension package
// with emptyOutDir on, and tests must never inherit that. The svelte() plugin still has to be
// here — the store tests import `.svelte.ts` rune modules, which plain esbuild cannot compile.
export default defineConfig({
	test: {
		projects: [
			{
				// Pure logic (lib/, stores) stays on the node environment it always ran in.
				plugins: [svelte()],
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts'],
				},
			},
			{
				// Component tests mount real Svelte trees, so they need a DOM and the browser-side
				// Svelte resolution (svelteTesting sets resolve.conditions) — without it, render()
				// picks the SSR branch and fails.
				plugins: [svelte(), svelteTesting()],
				test: {
					name: 'component',
					environment: 'jsdom',
					include: ['src/**/*.svelte.test.ts'],
				},
			},
		],
	},
});
