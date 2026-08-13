import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	// `vscode` is provided by the runtime, never bundle it.
	external: ['vscode'],
	sourcemap: true,
	logLevel: 'info',
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log('[esbuild] watching extension…');
} else {
	await esbuild.build(options);
}
