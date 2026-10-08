import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkingTreeActionMessage } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { WorkingTreeService } from './WorkingTreeService.js';
import { recorded, resetRecorded } from '../../test/vscodeStub.js';
import { FakeGit } from '../../test/fakeGit.js';

const CWD = '/repo';

const YES: UserPrompt = {
	confirm: () => Promise.resolve(true),
	pickOptions: (request) => Promise.resolve(request.listOptions.map((option) => option.id)),
	inputText: () => Promise.resolve(undefined),
};

function discard(path = 'src/a.ts'): WorkingTreeActionMessage {
	return { type: 'workingTreeAction', repoPath: CWD, action: 'discard', path };
}

/**
 * The error notice is deliberately fire-and-forget — it stats the lock file and may then wait on a
 * button, so the action must not block on it. Tests therefore have to let that settle.
 */
async function shownErrors(): Promise<string> {
	for (let attempt = 0; attempt < 50 && recorded.listErrors.length === 0; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return recorded.listErrors.join('\n');
}

describe('WorkingTreeService discard', () => {
	beforeEach(resetRecorded);

	it('restores a tracked file from HEAD', async () => {
		const git = new FakeGit();

		expect(await new WorkingTreeService(git).run(discard(), CWD, YES)).toBe(true);

		expect(git.ranArgv('checkout HEAD -- src/a.ts')).toBe(true);
		expect(git.ran('clean')).toBe(false);
	});

	it('removes an untracked file, which checkout cannot restore', async () => {
		const git = new FakeGit().rejectOn(
			'checkout',
			"error: pathspec 'src/a.ts' did not match any file(s) known to git"
		);

		expect(await new WorkingTreeService(git).run(discard(), CWD, YES)).toBe(true);

		expect(git.ranArgv('clean -fd -- src/a.ts')).toBe(true);
	});

	it('never deletes the file when checkout failed for any other reason', async () => {
		// The whole point: `checkout HEAD -- <path>` also fails when .git/index.lock is held. Reading
		// that as "must be untracked" and reaching for `clean` would delete a tracked file the user
		// only asked to revert — and the confirm dialog promised to discard changes, not the file.
		const git = new FakeGit().rejectOn(
			'checkout',
			"fatal: Unable to create '/repo/.git/index.lock': File exists."
		);

		expect(await new WorkingTreeService(git).run(discard(), CWD, YES)).toBe(false);

		expect(git.ran('clean')).toBe(false);
		expect(await shownErrors()).toMatch(/lock|holding this repository/i);
	});

	it('does nothing at all when the confirm is declined', async () => {
		const git = new FakeGit();
		const no: UserPrompt = { ...YES, confirm: () => Promise.resolve(false) };

		expect(await new WorkingTreeService(git).run(discard(), CWD, no)).toBe(false);

		expect(git.listCalls).toHaveLength(0);
	});
});

describe('WorkingTreeService failures', () => {
	beforeEach(resetRecorded);

	it('explains a held lock instead of repeating git about a process that is not running', async () => {
		const git = new FakeGit().rejectOn(
			'add',
			"fatal: Unable to create '/repo/.git/index.lock': File exists.\n" +
				'Another git process seems to be running in this repository'
		);

		const changed = await new WorkingTreeService(git).run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'stageAll' },
			CWD,
			YES
		);

		expect(changed).toBe(false);
		const shown = await shownErrors();
		expect(shown).toMatch(/stale lock|holding this repository/i);
		expect(shown).not.toContain('seems to be running');
	});

	it('recognises the wording stash uses, which never names the lock file', async () => {
		const git = new FakeGit().rejectOn('stash', 'error: could not write index');
		const named: UserPrompt = { ...YES, inputText: () => Promise.resolve('wip') };

		await new WorkingTreeService(git).run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'stash' },
			CWD,
			named
		);

		expect(await shownErrors()).toMatch(/holding this repository/i);
	});
});
