import esbuild from 'esbuild';

// Three bundles: the Electron main process, the renderer's preload, and the host that runs git.
await esbuild.build({
	entryPoints: {
		main: 'spike/main.ts',
		preload: 'spike/preload.ts',
		host: 'spike/host.ts',
	},
	outdir: 'spike/dist',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	external: ['electron'],
	sourcemap: true,
	logLevel: 'info',
});
