import { askpassHelperPaths, buildAskpassEnv } from '@git-octopus/host/adapters/askpass/askpassEnv';

export interface DesktopAskpassEnvOptions {
	/** Directory the helper (`askpass.sh`, `askpass-main.cjs`) was copied to inside the app. */
	helperDir: string;
	/** The server's connection handle: the unix socket it listens on. */
	handle: string;
	/** The live nonce of the one git invocation the environment is granted to. */
	nonce: string;
	/** The app's own executable; the helper runs under it as node. */
	execPath?: string;
	/** The caller's `DISPLAY`. */
	display?: string;
}

/**
 * The environment that makes git and ssh run the askpass helper with the app's own binary: the
 * Electron executable started with `ELECTRON_RUN_AS_NODE=1`, so no separate node has to be
 * installed or shipped. That needs the `RunAsNode` fuse left on in the packaged app.
 */
export function buildDesktopAskpassEnv(options: DesktopAskpassEnvOptions): Record<string, string> {
	return {
		...buildAskpassEnv({
			...askpassHelperPaths(options.helperDir),
			nodePath: options.execPath ?? process.execPath,
			handle: options.handle,
			nonce: options.nonce,
			display: options.display ?? process.env.DISPLAY,
		}),
		ELECTRON_RUN_AS_NODE: '1',
	};
}
