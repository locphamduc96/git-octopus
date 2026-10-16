import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkingTreeActionMessage } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { WorkingTreeService } from './WorkingTreeService.js';
import { recorded, resetRecorded, testShell } from '../../test/fakeShell.js';
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

		expect(await new WorkingTreeService(git, testShell).run(discard(), CWD, YES)).toBe(true);

		expect(git.ranArgv('checkout HEAD -- src/a.ts')).toBe(true);
		expect(git.ran('clean')).toBe(false);
	});

	it('removes an untracked file, which checkout cannot restore', async () => {
		const git = new FakeGit().rejectOn(
			'checkout',
			"error: pathspec 'src/a.ts' did not match any file(s) known to git"
		);

		expect(await new WorkingTreeService(git, testShell).run(discard(), CWD, YES)).toBe(true);

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

		expect(await new WorkingTreeService(git, testShell).run(discard(), CWD, YES)).toBe(false);

		expect(git.ran('clean')).toBe(false);
		expect(await shownErrors()).toMatch(/lock|holding this repository/i);
	});

	it('does nothing at all when the confirm is declined', async () => {
		const git = new FakeGit();
		const no: UserPrompt = { ...YES, confirm: () => Promise.resolve(false) };

		expect(await new WorkingTreeService(git, testShell).run(discard(), CWD, no)).toBe(false);

		// The one read that decides whether the question is asked at all.
		expect(git.listCalls).toEqual([['ls-files', '--stage', '--', 'src/a.ts']]);
	});

	it('refuses a submodule before asking anything, and runs nothing that writes', async () => {
		const git = new FakeGit({
			'ls-files --stage': `160000 ${'a'.repeat(40)} 0\tlibs/engine\n`,
		});
		let asked = false;
		const prompt: UserPrompt = {
			...YES,
			confirm: () => {
				asked = true;
				return Promise.resolve(true);
			},
		};

		expect(
			await new WorkingTreeService(git, testShell).run(discard('libs/engine'), CWD, prompt)
		).toBe(false);

		expect(asked).toBe(false);
		expect(git.ran('checkout')).toBe(false);
		expect(git.ran('clean')).toBe(false);
		expect(recorded.listWarnings.join('\n')).toMatch(/submodule update -- libs\/engine/);
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

		const changed = await new WorkingTreeService(git, testShell).run(
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

		await new WorkingTreeService(git, testShell).run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'stash' },
			CWD,
			named
		);

		expect(await shownErrors()).toMatch(/holding this repository/i);
	});
});

describe('WorkingTreeService restoreFromCommit', () => {
	beforeEach(resetRecorded);

	const restore = (over: Partial<WorkingTreeActionMessage> = {}): WorkingTreeActionMessage => ({
		type: 'workingTreeAction',
		repoPath: CWD,
		action: 'restoreFromCommit',
		path: 'src/a.ts',
		hash: 'abc1234def',
		...over,
	});

	it('restores the file from the commit into both the index and the working tree', async () => {
		const git = new FakeGit();

		expect(await new WorkingTreeService(git, testShell).run(restore(), CWD, YES)).toBe(true);

		expect(git.ranArgv('restore --source=abc1234def --staged --worktree -- src/a.ts')).toBe(true);
	});

	it('runs nothing when the user does not confirm', async () => {
		const git = new FakeGit();
		const NO: UserPrompt = { ...YES, confirm: () => Promise.resolve(false) };

		expect(await new WorkingTreeService(git, testShell).run(restore(), CWD, NO)).toBe(false);

		expect(git.ran('restore')).toBe(false);
	});

	it('refuses without a commit to restore from', async () => {
		const git = new FakeGit();

		expect(
			await new WorkingTreeService(git, testShell).run(restore({ hash: undefined }), CWD, YES)
		).toBe(false);

		expect(git.ran('restore')).toBe(false);
	});
});

describe('WorkingTreeService commit hooks', () => {
	beforeEach(resetRecorded);

	it('skips the hooks with --no-verify only when asked', async () => {
		const git = new FakeGit();
		const service = new WorkingTreeService(git, testShell);
		await service.run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'commit', message: 'x', noVerify: true },
			CWD,
			YES
		);
		await service.run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'commit', message: 'y' },
			CWD,
			YES
		);
		expect(git.ranArgv('commit --no-verify -m x')).toBe(true);
		expect(git.ranArgv('commit -m y')).toBe(true);
	});
});

describe('WorkingTreeService openMergeEditor', () => {
	beforeEach(resetRecorded);

	it("hands the file to the shell's merge editor and runs no git", async () => {
		const git = new FakeGit();
		const changed = await new WorkingTreeService(git, testShell).run(
			{ type: 'workingTreeAction', repoPath: CWD, action: 'openMergeEditor', path: 'src/a.ts' },
			CWD,
			YES
		);
		expect(changed).toBe(false);
		expect(recorded.listMergeEditor).toEqual([path.join(CWD, 'src/a.ts')]);
		expect(git.listCalls).toEqual([]);
	});
});
