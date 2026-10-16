import type { SubmoduleDiff } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

/**
 * `git config -z --file .gitmodules --get-regexp` output: `submodule.<name>.path` NL `<path>` NUL per
 * entry. `-z` because a submodule's name — the middle of the key — may hold spaces, and without it
 * the line form cannot say where the key stops.
 */
export function parseSubmodulePaths(output: string): string[] {
	const listPaths: string[] = [];
	for (const entry of output.split('\0')) {
		const newline = entry.indexOf('\n');
		if (newline === -1 || !/^submodule\..+\.path$/.test(entry.slice(0, newline))) continue;
		const subPath = entry.slice(newline + 1).trim();
		if (subPath !== '' && !listPaths.includes(subPath)) listPaths.push(subPath);
	}
	return listPaths;
}

/** Where `.gitmodules` says this repository's submodules live, relative to it. */
export async function getSubmodulePaths(executor: GitExecutor, cwd: string): Promise<string[]> {
	const output = await executor
		.run(
			['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'],
			cwd,
			// 1: no submodules. A missing .gitmodules exits 1 too.
			[1]
		)
		.catch(() => '');
	return parseSubmodulePaths(output);
}

/** What git prints for a submodule's side of a diff: `Subproject commit <id>[-dirty]`. */
export function parseSubproject(text: string): { commit: string; dirty: boolean } | null {
	const match = /^Subproject commit ([0-9a-f]{7,64})(-dirty)?\s*$/.exec(text.trim());
	return match ? { commit: match[1], dirty: match[2] !== undefined } : null;
}

/** The pointer move a submodule's diff stands for, or null when the text is not one. */
export function submoduleDiff(
	before: string,
	after: string,
	repoPath: string | null
): SubmoduleDiff | null {
	const from = before.trim() === '' ? null : parseSubproject(before);
	const to = after.trim() === '' ? null : parseSubproject(after);
	if ((before.trim() !== '' && !from) || (after.trim() !== '' && !to) || (!from && !to))
		return null;
	return {
		...(from ? { from: from.commit } : {}),
		...(to ? { to: to.commit } : {}),
		dirty: to?.dirty ?? false,
		repoPath,
	};
}
