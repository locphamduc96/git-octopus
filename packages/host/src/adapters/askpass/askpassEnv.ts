import * as path from 'node:path';

/** The two files of the helper, side by side in one directory. */
export const ASKPASS_SCRIPT_NAME = 'askpass.sh';
export const ASKPASS_MAIN_NAME = 'askpass-main.cjs';

export interface AskpassHelperPaths {
	/** askpass.sh, handed to git and ssh as the program to run. */
	scriptPath: string;
	/** askpass-main.cjs, run by the script under the node binary. */
	mainPath: string;
}

/** Where the helper's files are, given the directory they were copied to. */
export function askpassHelperPaths(helperDir: string): AskpassHelperPaths {
	return {
		scriptPath: path.join(helperDir, ASKPASS_SCRIPT_NAME),
		mainPath: path.join(helperDir, ASKPASS_MAIN_NAME),
	};
}

export interface AskpassEnvParts extends AskpassHelperPaths {
	/** The node binary the script runs the client with — the host app's own executable. */
	nodePath: string;
	/** Unix socket the server listens on. */
	handle: string;
	/** The live nonce of the one git invocation this environment is granted to. */
	nonce: string;
	/** The caller's `DISPLAY`; older OpenSSH only consults askpass when one is set. */
	display?: string;
}

/** The environment that makes git and ssh run the helper for one granted invocation. */
export function buildAskpassEnv(parts: AskpassEnvParts): Record<string, string> {
	const mapEnv: Record<string, string> = {
		GIT_ASKPASS: parts.scriptPath,
		SSH_ASKPASS: parts.scriptPath,
		// OpenSSH ≥ 8.4 honours this; older versions want DISPLAY, provided below.
		SSH_ASKPASS_REQUIRE: 'force',
		GIT_OCTOPUS_ASKPASS_NODE: parts.nodePath,
		GIT_OCTOPUS_ASKPASS_MAIN: parts.mainPath,
		GIT_OCTOPUS_ASKPASS_HANDLE: parts.handle,
		GIT_OCTOPUS_ASKPASS_NONCE: parts.nonce,
	};
	if (!parts.display) mapEnv.DISPLAY = ':0';
	return mapEnv;
}
