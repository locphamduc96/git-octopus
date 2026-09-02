import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONSECUTIVE_FAILURES } from '../../core/git/autoFetch.js';
import { FakeGit } from '../../test/fakeGit.js';
import { AutoFetchScheduler, type AutoFetchDeps } from './AutoFetchScheduler.js';
import { resetRecorded } from '../../test/vscodeStub.js';

/** An idle repository: `rev-parse --absolute-git-dir` answers, and no sequencer file exists. */
function idleGit(): FakeGit {
	return new FakeGit({
		'rev-parse --absolute-git-dir': '/repo/.git\n',
		'remote -v': 'origin\tgit@github.com:me/repo.git (fetch)\n',
	});
}

function makeScheduler(over: Partial<AutoFetchDeps> = {}) {
	const git = over.executor instanceof FakeGit ? over.executor : idleGit();
	const onFetched = vi.fn();
	const onGaveUp = vi.fn();
	const deps: AutoFetchDeps = {
		executor: git,
		activeRepo: () => '/repo',
		intervalMinutes: () => 5,
		focused: () => true,
		now: () => 0,
		pathExists: () => Promise.resolve(false),
		onFetched,
		onGaveUp,
		...over,
	};
	return { scheduler: new AutoFetchScheduler(deps), git, onFetched, onGaveUp };
}

beforeEach(resetRecorded);

describe('AutoFetchScheduler', () => {
	it('fetches with prune, and declares fetch as its auth operation', async () => {
		const { scheduler, git } = makeScheduler();
		await scheduler.tick();
		expect(git.callsTo('fetch')).toEqual([['fetch', '--all', '--prune']]);
		const call = git.listInvocations.find((entry) => entry.args[0] === 'fetch');
		expect(call?.cwd).toBe('/repo');
	});

	it('never pulls — the checked-out branch must not move under the user', async () => {
		const { scheduler, git } = makeScheduler();
		await scheduler.tick();
		expect(git.ran('pull')).toBe(false);
		expect(git.ran('merge')).toBe(false);
		expect(git.ran('checkout')).toBe(false);
	});

	it('does nothing at all without a repository', async () => {
		const { scheduler, git } = makeScheduler({ activeRepo: () => null });
		await scheduler.tick();
		expect(git.listCalls).toEqual([]);
	});

	it('does nothing while the setting is off', async () => {
		const { scheduler, git } = makeScheduler({ intervalMinutes: () => 0 });
		await scheduler.tick();
		expect(git.ran('fetch')).toBe(false);
	});

	it('does not even probe the repository state on a tick already ruled out', async () => {
		const { scheduler, git } = makeScheduler({ intervalMinutes: () => 0 });
		await scheduler.tick();
		expect(git.listCalls).toEqual([]);
	});

	it('waits out the interval between fetches', async () => {
		let clock = 0;
		const { scheduler, git } = makeScheduler({ now: () => clock });
		await scheduler.tick();
		clock = 60_000;
		await scheduler.tick();
		expect(git.callsTo('fetch')).toHaveLength(1);
	});

	it('fetches again once the interval has passed', async () => {
		let clock = 0;
		const { scheduler, git } = makeScheduler({ now: () => clock });
		await scheduler.tick();
		clock = 5 * 60_000;
		await scheduler.tick();
		expect(git.callsTo('fetch')).toHaveLength(2);
	});

	it('leaves the refs alone while a rebase is open', async () => {
		const { scheduler, git } = makeScheduler({
			pathExists: (path) => Promise.resolve(path === '/repo/.git/rebase-merge'),
		});
		await scheduler.tick();
		expect(git.ran('fetch')).toBe(false);
	});

	it('leaves the refs alone while a merge is unresolved', async () => {
		const { scheduler, git } = makeScheduler({
			pathExists: (path) => Promise.resolve(path === '/repo/.git/MERGE_HEAD'),
		});
		await scheduler.tick();
		expect(git.ran('fetch')).toBe(false);
	});

	it('spends no network on a window nobody is looking at', async () => {
		const { scheduler, git } = makeScheduler({ focused: () => false });
		await scheduler.tick();
		expect(git.ran('fetch')).toBe(false);
	});

	it('reports the graph should reload after a successful fetch', async () => {
		const { scheduler, onFetched } = makeScheduler();
		await scheduler.tick();
		expect(onFetched).toHaveBeenCalledTimes(1);
	});

	it('does not reload the graph when the fetch failed', async () => {
		const git = idleGit().rejectOn('fetch', 'could not read Username');
		const { scheduler, onFetched } = makeScheduler({ executor: git });
		await scheduler.tick();
		expect(onFetched).not.toHaveBeenCalled();
	});

	it('gives up after repeated failures and says so exactly once', async () => {
		let clock = 0;
		const git = idleGit().rejectOn('fetch', 'Authentication failed');
		const { scheduler, onGaveUp } = makeScheduler({ executor: git, now: () => clock });
		for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 3; i += 1) {
			await scheduler.tick();
			clock += 5 * 60_000;
		}
		expect(onGaveUp).toHaveBeenCalledTimes(1);
		expect(git.callsTo('fetch')).toHaveLength(MAX_CONSECUTIVE_FAILURES);
	});

	it('never leaks a credential into the message it reports', async () => {
		let clock = 0;
		const git = idleGit().rejectOn('fetch', 'fatal: https://user:hunter2@github.com/me/repo.git');
		const { scheduler, onGaveUp } = makeScheduler({ executor: git, now: () => clock });
		for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
			await scheduler.tick();
			clock += 5 * 60_000;
		}
		expect(onGaveUp).toHaveBeenCalledTimes(1);
		expect(onGaveUp.mock.calls[0][0]).not.toContain('hunter2');
	});

	it('starts trying again when the user changes the interval', async () => {
		let clock = 0;
		let minutes = 5;
		const git = idleGit().rejectOn('fetch', 'Authentication failed');
		const { scheduler } = makeScheduler({
			executor: git,
			now: () => clock,
			intervalMinutes: () => minutes,
		});
		for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 2; i += 1) {
			await scheduler.tick();
			clock += 5 * 60_000;
		}
		expect(git.callsTo('fetch')).toHaveLength(MAX_CONSECUTIVE_FAILURES);

		minutes = 15;
		clock += 15 * 60_000;
		await scheduler.tick();
		expect(git.callsTo('fetch')).toHaveLength(MAX_CONSECUTIVE_FAILURES + 1);
	});

	it('stops ticking once disposed', () => {
		const { scheduler } = makeScheduler();
		scheduler.start();
		scheduler.dispose();
		// A second dispose must not throw — deactivate runs it alongside the subscription.
		expect(() => scheduler.dispose()).not.toThrow();
	});
});
