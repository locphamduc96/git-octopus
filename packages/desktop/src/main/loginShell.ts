import { execFile } from 'node:child_process';

/**
 * A Mac app started from Finder, the Dock or Spotlight gets launchd's PATH — `/usr/bin:/bin:…` —
 * not the one the user's shell builds. Homebrew's git and the agent CLIs live on the latter, so it is
 * read once, at launch, from a login shell. Started from a terminal, the app already has it.
 */
const MARKER = '__GIT_OCTOPUS_PATH__';

export function launchedFromShell(env: NodeJS.ProcessEnv): boolean {
	return env.SHLVL !== undefined || env.TERM_PROGRAM !== undefined;
}

/** The PATH between the markers — a shell's startup files may print anything around it. */
export function parseShellPath(stdout: string): string | null {
	const start = stdout.indexOf(MARKER);
	const end = stdout.indexOf(MARKER, start + MARKER.length);
	if (start === -1 || end === -1) return null;
	const value = stdout.slice(start + MARKER.length, end).trim();
	return value === '' ? null : value;
}

/** The shell's entries first, then whatever the app had that the shell did not. */
export function mergePaths(shellPath: string, currentPath = ''): string {
	const listMerged: string[] = [];
	for (const entry of [...shellPath.split(':'), ...currentPath.split(':')]) {
		if (entry !== '' && !listMerged.includes(entry)) listMerged.push(entry);
	}
	return listMerged.join(':');
}

export function adoptLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<void> {
	if (launchedFromShell(env)) return Promise.resolve();
	const shell = env.SHELL || '/bin/zsh';
	return new Promise((resolve) => {
		execFile(
			shell,
			['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`],
			{ timeout: 4000, env },
			(_error, stdout) => {
				const shellPath = parseShellPath(String(stdout ?? ''));
				if (shellPath) env.PATH = mergePaths(shellPath, env.PATH);
				resolve();
			}
		);
	});
}
