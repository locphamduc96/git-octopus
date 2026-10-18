import { cpSync, existsSync, rmSync } from 'node:fs';
import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';

// The view is the webview's own build, made by `pnpm --filter @git-octopus/webview build`.
const WEBVIEW_BUILD = '../extension/media/webview';
if (!existsSync(`${WEBVIEW_BUILD}/webview.js`)) {
	throw new Error(`${WEBVIEW_BUILD} is missing — build the webview first.`);
}

// The CommonJS bundles Electron loads: main, the three preloads (a tab's view, the tab strip, the
// Welcome page), the host.
await esbuild.build({
	entryPoints: {
		main: 'src/main/main.ts',
		preload: 'src/preload.ts',
		tabsPreload: 'src/tabsPreload.ts',
		welcomePreload: 'src/welcomePreload.ts',
		host: 'src/host/hostMain.ts',
	},
	outdir: 'dist',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	external: ['electron'],
	sourcemap: true,
	logLevel: 'info',
});

rmSync('dist/renderer', { recursive: true, force: true });
cpSync(WEBVIEW_BUILD, 'dist/renderer', { recursive: true });

// The tab strip, a Svelte page of its own, into dist/tabs.
await viteBuild({ configFile: 'vite.tabs.config.mts', logLevel: 'warn' });

// The Welcome page, the same way, into dist/welcome.
await viteBuild({ configFile: 'vite.welcome.config.mts', logLevel: 'warn' });
