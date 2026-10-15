import type { WorktreeInfo } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

/**
 * Parse `git worktree list --porcelain`: one block per worktree, blank-line separated, the main
 * worktree first. `current` is the top level of the worktree this window has open, as git
 * prints paths, so the two compare as strings.
 */
export function parseWorktrees(output: string, current: string | null): WorktreeInfo[] {
	return output
		.split(/\n\n+/)
		.map((block) => block.split('\n').filter((line) => line !== ''))
		.filter((listLines) => listLines[0]?.startsWith('worktree '))
		.map((listLines, index) => {
			const value = (key: string): string | undefined => {
				const line = listLines.find((entry) => entry === key || entry.startsWith(`${key} `));
				return line === undefined ? undefined : line.slice(key.length + 1);
			};
			const path = value('worktree') ?? '';
			const branch = value('branch');
			return {
				path,
				head: value('HEAD') ?? null,
				branch: branch ? branch.replace(/^refs\/heads\//, '') : null,
				isMain: index === 0,
				isCurrent: current !== null && path === current,
				locked: value('locked') !== undefined,
				prunable: value('prunable') !== undefined,
			};
		});
}

export async function getWorktrees(executor: GitExecutor, cwd: string): Promise<WorktreeInfo[]> {
	const [output, top] = await Promise.all([
		executor.run(['worktree', 'list', '--porcelain'], cwd),
		executor.run(['rev-parse', '--show-toplevel'], cwd).catch(() => ''),
	]);
	return parseWorktrees(output, top.trim() || null);
}

/** Where a new worktree for `branch` goes when nobody says: beside the repository, named after both. */
export function defaultWorktreePath(repoTop: string, branch: string): string {
	const slash = Math.max(repoTop.lastIndexOf('/'), repoTop.lastIndexOf('\\'));
	const parent = slash === -1 ? '.' : repoTop.slice(0, slash);
	const name = repoTop.slice(slash + 1);
	return `${parent}/${name}-${branch.replace(/[\\/]/g, '-')}`;
}
