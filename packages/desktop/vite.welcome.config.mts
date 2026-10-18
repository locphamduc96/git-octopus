import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The Welcome page: shown in the window while it has no tab, built next to the tab strip.
export default defineConfig({
	plugins: [svelte()],
	root: fileURLToPath(new URL('./src/welcome', import.meta.url)),
	base: './',
	build: {
		outDir: fileURLToPath(new URL('./dist/welcome', import.meta.url)),
		emptyOutDir: true,
		rollupOptions: {
			output: {
				entryFileNames: 'welcome.js',
				assetFileNames: 'welcome.[ext]',
			},
		},
	},
});
