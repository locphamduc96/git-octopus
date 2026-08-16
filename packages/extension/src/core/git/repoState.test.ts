import { describe, expect, it } from 'vitest';
import type { GitExecutor } from './GitExecutor';
import { getRepoState } from './gitService';

const GIT_DIR = '/repo/.git';

const executor: GitExecutor = {
	run: (args: string[]) =>
		args.includes('--absolute-git-dir')
			? Promise.resolve(`${GIT_DIR}\n`)
			: Promise.reject(new Error(`unexpected: ${args.join(' ')}`)),
};

/** An `exists` that reports only the given entries under the git dir. */
function existsFor(...listEntries: string[]): (path: string) => Promise<boolean> {
	return (path) => Promise.resolve(listEntries.some((entry) => path === `${GIT_DIR}/${entry}`));
}

describe('getRepoState', () => {
	it('reports null in a quiet repository', async () => {
		expect(await getRepoState(executor, '/repo', existsFor())).toBeNull();
	});

	it('detects each paused operation the way git itself does', async () => {
		expect(await getRepoState(executor, '/repo', existsFor('rebase-merge'))).toBe('rebasing');
		expect(await getRepoState(executor, '/repo', existsFor('rebase-apply'))).toBe('rebasing');
		expect(await getRepoState(executor, '/repo', existsFor('MERGE_HEAD'))).toBe('merging');
		expect(await getRepoState(executor, '/repo', existsFor('CHERRY_PICK_HEAD'))).toBe(
			'cherryPicking'
		);
		expect(await getRepoState(executor, '/repo', existsFor('REVERT_HEAD'))).toBe('reverting');
	});

	it('ignores a stale REBASE_HEAD left behind by a finished rebase', async () => {
		// Git can leave the REBASE_HEAD file in place after a rebase concludes; only the
		// rebase-merge/rebase-apply directories mean a rebase is actually under way.
		expect(await getRepoState(executor, '/repo', existsFor('REBASE_HEAD'))).toBeNull();
	});

	it('prefers rebasing when the rebase also wrote CHERRY_PICK_HEAD', async () => {
		expect(
			await getRepoState(executor, '/repo', existsFor('rebase-merge', 'CHERRY_PICK_HEAD'))
		).toBe('rebasing');
	});

	it('reports null when the git dir cannot be resolved', async () => {
		const broken: GitExecutor = { run: () => Promise.reject(new Error('not a repository')) };
		expect(await getRepoState(broken, '/repo', existsFor('rebase-merge'))).toBeNull();
	});
});
