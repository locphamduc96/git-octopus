import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../extension/media/webview', import.meta.url));

export default defineConfig({
	plugins: [svelte()],
	build: {
		outDir,
		emptyOutDir: true,
		// The VS Code webview references these by fixed names, so disable hashing.
		rollupOptions: {
			output: {
				entryFileNames: 'webview.js',
				assetFileNames: 'webview.[ext]',
			},
		},
	},
});
