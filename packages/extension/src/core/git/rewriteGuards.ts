import type { GitExecutor } from './GitExecutor.js';

/**
 * Prove against the repository that `listHashes` (newest → oldest) is exactly the first-parent
 * chain below its newest commit: every hash present, in order, contiguous, with no merge and no
 * root among them.
 *
 * This is the host's answer to a stale or forged selection: the graph the user clicked in may be
 * behind the repository — a fetch, rebase or another view can move history between render and
 * confirm — and a linear rewrite scoped by unverified hashes would rewrite whatever is there now,
 * not what they saw.
 */
export async function isFirstParentRun(
	executor: GitExecutor,
	listHashes: string[],
	cwd: string
): Promise<boolean> {
	if (listHashes.length === 0) return false;
	try {
		const output = await executor.run(
			['rev-list', '--first-parent', '--parents', '-n', String(listHashes.length), listHashes[0]],
			cwd
		);
		const listLines = output.trim().split('\n');
		if (listLines.length !== listHashes.length) return false;
		return listLines.every((line, index) => {
			const listParts = line.split(' ');
			// One hash plus exactly one parent: a merge (two parents) or the root (none) may not be
			// squashed or dropped by a linear rewrite.
			return listParts[0] === listHashes[index] && listParts.length === 2;
		});
	} catch {
		return false;
	}
}
