import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The tab strip: a page of its own across the top of the window, built next to the main bundles.
export default defineConfig({
	plugins: [svelte()],
	root: fileURLToPath(new URL('./src/tabs', import.meta.url)),
	base: './',
	build: {
		outDir: fileURLToPath(new URL('./dist/tabs', import.meta.url)),
		emptyOutDir: true,
		rollupOptions: {
			output: {
				entryFileNames: 'tabs.js',
				assetFileNames: 'tabs.[ext]',
			},
		},
	},
});
