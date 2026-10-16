import { describe, expect, it } from 'vitest';
import { LIST_LOCK_BACKOFF_MS, LockRetryGitExecutor } from './lockRetryGitExecutor';
import type { LockState } from './lockState';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

const LOCK_ERROR =
	"fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running";

/** A git that fails the first `failures` calls with `message`, then answers `ok`. */
class FlakyGit implements GitExecutor {
	public calls = 0;

	public constructor(
		private readonly failures: number,
		private readonly message = LOCK_ERROR
	) {}

	public run(): Promise<string> {
		this.calls += 1;
		return this.calls <= this.failures
			? Promise.reject(new Error(this.message))
			: Promise.resolve('ok');
	}
}

function harness(inner: GitExecutor, lock: LockState['kind'] = 'live') {
	const listSlept: number[] = [];
	const listRead: string[] = [];
	const executor = new LockRetryGitExecutor(inner, {
		sleep: (ms) => {
			listSlept.push(ms);
			return Promise.resolve();
		},
		readLock: (lockPath) => {
			listRead.push(lockPath);
			return Promise.resolve(lock === 'stale' ? { kind: 'stale', size: 0 } : { kind: lock });
		},
	});
	return { executor, listSlept, listRead };
}

describe('LockRetryGitExecutor', () => {
	it('waits out a lock another process held for a moment, and the write goes through', async () => {
		const inner = new FlakyGit(2);
		const { executor, listSlept, listRead } = harness(inner);

		await expect(executor.run(['commit', '-m', 'x'], '/repo')).resolves.toBe('ok');

		expect(inner.calls).toBe(3);
		expect(listSlept).toEqual(LIST_LOCK_BACKOFF_MS.slice(0, 2));
		expect(listRead).toEqual(['/repo/.git/index.lock', '/repo/.git/index.lock']);
	});

	it('gives up after the backoff runs out and surfaces the last lock error', async () => {
		const inner = new FlakyGit(Number.POSITIVE_INFINITY);
		const { executor, listSlept } = harness(inner);

		await expect(executor.run(['add', '--', 'a.ts'], '/repo')).rejects.toThrow(/index\.lock/);

		expect(inner.calls).toBe(LIST_LOCK_BACKOFF_MS.length + 1);
		expect(listSlept).toEqual(LIST_LOCK_BACKOFF_MS);
	});

	it('does not wait on a lock that is already junk — waiting will not remove it', async () => {
		const inner = new FlakyGit(Number.POSITIVE_INFINITY);
		const { executor, listSlept } = harness(inner, 'stale');

		await expect(executor.run(['reset', '-q', 'HEAD'], '/repo')).rejects.toThrow(/index\.lock/);

		expect(inner.calls).toBe(1);
		expect(listSlept).toEqual([]);
	});

	it('goes again at once when the lock is already gone by the time it looks', async () => {
		const inner = new FlakyGit(1);
		const { executor, listSlept } = harness(inner, 'gone');

		await expect(executor.run(['checkout', 'main'], '/repo')).resolves.toBe('ok');

		expect(inner.calls).toBe(2);
		expect(listSlept).toEqual([]);
	});

	it.each([
		['rebase', ['rebase', 'main']],
		['merge', ['merge', 'feature']],
		['pull', ['pull']],
		['cherry-pick', ['cherry-pick', 'abc']],
		['stash', ['stash', 'push', '--include-untracked']],
	])(
		'never runs %s twice — it can fail after it has already changed something',
		async (_, args) => {
			const inner = new FlakyGit(1);
			const { executor } = harness(inner);

			await expect(executor.run(args, '/repo')).rejects.toThrow(/index\.lock/);

			expect(inner.calls).toBe(1);
		}
	);

	it('does not retry a failure that is not about the lock', async () => {
		const inner = new FlakyGit(1, 'error: pathspec did not match any file(s) known to git');
		const { executor } = harness(inner);

		await expect(executor.run(['checkout', 'HEAD', '--', 'x'], '/repo')).rejects.toThrow(
			/pathspec/
		);

		expect(inner.calls).toBe(1);
	});

	it('sees the subcommand past global options', async () => {
		const inner = new FlakyGit(1);
		const { executor } = harness(inner);

		await expect(
			executor.run(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'x'], '/repo')
		).resolves.toBe('ok');

		expect(inner.calls).toBe(2);
	});
});
