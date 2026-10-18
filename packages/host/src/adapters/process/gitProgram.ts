import { homedir } from 'node:os';
import * as path from 'node:path';

/** What the shell runs when the user chose nothing: whichever `git` the PATH finds first. */
export const DEFAULT_GIT_PROGRAM = 'git';

type GitPathSource = () => string | undefined;

let gitPathSource: GitPathSource = () => undefined;

/**
 * Where the user's "Git path" setting is read from. Set once by a shell that has such a setting
 * (the desktop app); VS Code has its own `git.path` and leaves this alone, so it runs plain `git`.
 */
export function setGitPathSource(source: GitPathSource): void {
	gitPathSource = source;
}

/**
 * The program a setting names: the path when it holds one (a leading `~/` is the home folder),
 * otherwise `git` and the PATH.
 */
export function gitProgramFor(setting: string | undefined, home?: string): string {
	const trimmed = typeof setting === 'string' ? setting.trim() : '';
	if (trimmed === '') return DEFAULT_GIT_PROGRAM;
	if (trimmed === '~') return home ?? homedir();
	if (trimmed.startsWith('~/')) return path.join(home ?? homedir(), trimmed.slice(2));
	return trimmed;
}

/** The program to start for git right now. Read on every call, so a changed setting applies at once. */
export function resolveGitProgram(): string {
	return gitProgramFor(gitPathSource());
}
