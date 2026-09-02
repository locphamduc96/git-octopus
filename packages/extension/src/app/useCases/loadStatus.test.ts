import { describe, expect, it } from 'vitest';
import { fakeGit, makeRepoContext } from '../../test/fakeGit.js';
import { loadStatus } from './loadStatus.js';

describe('loadStatus', () => {
	it('reports a failing git as an error reply instead of rejecting', async () => {
		// Five of the six commands swallow their own failure inside `gitService`; `getStatus` does
		// not. Both callers run this with `void`, and one chains `watcher.watch()` off it — so a
		// rejection here used to leave the repository unwatched for the rest of the session.
		const git = fakeGit().rejectOn('status', 'fatal: not a git repository');

		const reply = await loadStatus(makeRepoContext({ executor: git }));

		expect(reply.type).toBe('error');
		expect(reply.type === 'error' && reply.message).toContain('not a git repository');
	});

	it('carries the repositories and the active path through the error reply', async () => {
		const git = fakeGit().rejectOn('status');

		const reply = await loadStatus(makeRepoContext({ executor: git }));

		expect(reply.type === 'error' && reply.activeRepo).toBe('/repo');
		expect(reply.type === 'error' && reply.repos).toHaveLength(1);
	});

	it('answers with an error and asks git nothing when no repository was found', async () => {
		const git = fakeGit();

		const reply = await loadStatus(makeRepoContext({ executor: git, cwd: null }));

		expect(reply.type).toBe('error');
		expect(git.listCalls).toHaveLength(0);
	});

	it('counts staged and unstaged entries into the badge number', async () => {
		// porcelain v2: `1 <XY> …` per tracked change, `? <path>` per untracked file.
		const git = fakeGit({
			status: [
				'1 M. N... 100644 100644 100644 aaa bbb staged.txt',
				'1 .M N... 100644 100644 100644 aaa bbb dirty.txt',
				'? untracked.txt',
				'',
			].join('\0'),
		});

		const reply = await loadStatus(makeRepoContext({ executor: git }));

		expect(reply.type).toBe('statusUpdate');
		// one staged + two unstaged
		expect(reply.type === 'statusUpdate' && reply.changeCount).toBe(3);
	});
});
