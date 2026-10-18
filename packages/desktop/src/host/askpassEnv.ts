import * as path from 'node:path';
import { AskpassServer } from '@git-octopus/host/adapters/askpass/askpassServer';
import type { CredentialPrompt } from '@git-octopus/host/app/ports/credentialPrompt';

/**
 * A path inside `app.asar` as the same file in `app.asar.unpacked`. Git cannot execute a script
 * out of an archive, so the helper is unpacked at build time (`asarUnpack`) and run from there.
 * A path outside an archive — the dev build — comes back as it was.
 */
export function unpackedPath(file: string): string {
	return file.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
}

/** Where the helper (`askpass.sh`, `askpass-main.cjs`) sits, given the folder the host runs from. */
export function desktopAskpassHelperDir(distDir: string): string {
	return unpackedPath(path.join(distDir, 'askpass'));
}

export interface DesktopAskpassOptions {
	/** The folder the host bundle runs from: `dist/`, or `app.asar/dist` in the packaged app. */
	distDir: string;
	/**
	 * The app's own executable. `askpass.sh` runs the helper under it as node by setting
	 * `ELECTRON_RUN_AS_NODE=1` for that one process: the variable is never in the environment git
	 * and its hooks and editors run with, where it would turn an Electron app into plain node.
	 * Needs the `RunAsNode` fuse left on in the packaged app.
	 */
	appBinary: string;
	prompt: CredentialPrompt;
}

/**
 * The askpass bridge of the desktop app: git and ssh are pointed at the unpacked helper, which
 * calls back into this process for a credential and is answered through `prompt`. Its leases carry
 * the environment, so handing the bridge to the executor is all the wiring git needs.
 */
export function createDesktopAskpass(options: DesktopAskpassOptions): AskpassServer {
	return new AskpassServer(
		desktopAskpassHelperDir(options.distDir),
		options.prompt,
		options.appBinary
	);
}
