import * as path from 'node:path';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** A template as a message to start from: comment lines gone, blank lines at either end trimmed. */
export function cleanTemplate(text: string): string {
	return text
		.split('\n')
		.filter((line) => !line.startsWith('#'))
		.join('\n')
		.replace(/^\s*\n/, '')
		.trimEnd();
}

/**
 * Where `commit.template` points: `~/` is the home directory, a relative path is taken from the
 * repository's root — which is where git itself, run from there, would look.
 */
export function templatePath(configured: string, cwd: string, home: string): string {
	if (configured.startsWith('~/')) return path.join(home, configured.slice(2));
	return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

/** The repository's commit template, cleaned; null when none is set or it cannot be read. */
export async function readCommitTemplate(
	executor: GitExecutor,
	cwd: string,
	readFile: (file: string) => Promise<string>,
	home: string
): Promise<string | null> {
	// `--get` exits 1 when the key is unset: an answer, not a failure.
	const configured = (await executor.run(['config', '--get', 'commit.template'], cwd, [1])).trim();
	if (configured === '') return null;
	try {
		const text = cleanTemplate(await readFile(templatePath(configured, cwd, home)));
		return text === '' ? null : text;
	} catch {
		return null;
	}
}
