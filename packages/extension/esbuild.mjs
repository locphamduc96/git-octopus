import { cpSync, rmSync } from 'node:fs';
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// The askpass helper is not bundled — git runs it as a program — so it ships next to the bundle,
// which is where extension.ts looks for it.
const HELPER_SOURCE = '../host/media/askpass';
const HELPER_TARGET = 'dist/askpass';
rmSync(HELPER_TARGET, { recursive: true, force: true });
cpSync(HELPER_SOURCE, HELPER_TARGET, { recursive: true });

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
