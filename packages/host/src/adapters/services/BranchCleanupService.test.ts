import { beforeEach, describe, expect, it } from 'vitest';
import type { CleanupBranchesMessage } from '@git-octopus/shared';
import { BranchCleanupService } from './BranchCleanupService.js';
import { FakeGit } from '../../test/fakeGit.js';
import { recorded, resetRecorded, testShell } from '../../test/fakeShell.js';

const CWD = '/repo';
const TIP = 'aaaa111';

function message(overrides: Partial<CleanupBranchesMessage> = {}): CleanupBranchesMessage {
	return {
		type: 'cleanupBranches',
		repoPath: CWD,
		listNames: ['feature/old'],
		mapExpectedTips: { 'feature/old': TIP },
		force: false,
		...overrides,
	};
}

/** A git whose every branch resolves to the tip the dialog is pinned against. */
function gitAt(tip = TIP): FakeGit {
	return new FakeGit({ 'rev-parse': `${tip}\n` });
}

beforeEach(resetRecorded);

describe('BranchCleanupService', () => {
	it('deletes a branch whose tip still matches what the dialog showed', async () => {
		const git = gitAt();

		const { listResults, changed } = await new BranchCleanupService(git, testShell).run(
			message(),
			CWD
		);

		expect(listResults).toEqual([{ name: 'feature/old', hash: TIP, ok: true }]);
		expect(changed).toBe(true);
		expect(git.callsTo('branch')).toEqual([['branch', '-d', '--', 'feature/old']]);
	});

	it('passes -D only when the message asked to force', async () => {
		const git = gitAt();

		await new BranchCleanupService(git, testShell).run(message({ force: true }), CWD);

		expect(git.callsTo('branch')[0]).toEqual(['branch', '-D', '--', 'feature/old']);
	});

	it('refuses a name that could read as an option instead of running git', async () => {
		// A crafted message must not be able to smuggle flags onto the `git branch` command line.
		const git = gitAt();

		const { listResults, changed } = await new BranchCleanupService(git, testShell).run(
			message({ listNames: ['--all'], mapExpectedTips: { '--all': TIP } }),
			CWD
		);

		expect(listResults[0].ok).toBe(false);
		expect(listResults[0].reason).toBe('not a valid branch name');
		expect(changed).toBe(false);
		expect(git.listCalls).toHaveLength(0);
	});

	it('refuses a blank name', async () => {
		const git = gitAt();

		const { listResults } = await new BranchCleanupService(git, testShell).run(
			message({ listNames: ['   '], mapExpectedTips: { '   ': TIP } }),
			CWD
		);

		expect(listResults[0].reason).toBe('not a valid branch name');
		expect(git.listCalls).toHaveLength(0);
	});

	it('refuses a branch whose tip moved since the list was loaded', async () => {
		// The user would be deleting commits that were never on screen.
		const git = gitAt('bbbb222');

		const { listResults, changed } = await new BranchCleanupService(git, testShell).run(
			message(),
			CWD
		);

		expect(listResults[0].ok).toBe(false);
		expect(listResults[0].reason).toContain('moved since the list was loaded');
		expect(changed).toBe(false);
		expect(git.ran('branch')).toBe(false);
	});

	it('refuses a name the dialog never pinned', async () => {
		const git = gitAt();

		const { listResults } = await new BranchCleanupService(git, testShell).run(
			message({ mapExpectedTips: {} }),
			CWD
		);

		expect(listResults[0].ok).toBe(false);
		expect(git.ran('branch')).toBe(false);
	});

	it('resolves the tip through the full ref so a same-named tag cannot win', async () => {
		const git = gitAt();

		await new BranchCleanupService(git, testShell).run(
			message({ listNames: ['release'], mapExpectedTips: { release: TIP } }),
			CWD
		);

		expect(git.callsTo('rev-parse')[0]).toEqual(['rev-parse', '--verify', 'refs/heads/release']);
	});

	it('keeps deleting the rest after one branch is refused', async () => {
		// One `git branch -d` per name exists precisely so a single refusal does not abort the batch.
		const git = new FakeGit({ 'rev-parse --verify refs/heads/keep': `${TIP}\n` });

		const { listResults, changed } = await new BranchCleanupService(git, testShell).run(
			message({
				listNames: ['moved', 'keep'],
				mapExpectedTips: { moved: TIP, keep: TIP },
			}),
			CWD
		);

		expect(listResults[0].ok).toBe(false);
		expect(listResults[1]).toEqual({ name: 'keep', hash: TIP, ok: true });
		expect(changed).toBe(true);
	});

	it('reports a git refusal as that branch reason rather than throwing', async () => {
		const git = gitAt().rejectOn('branch', 'error: branch is not fully merged');

		const { listResults, changed } = await new BranchCleanupService(git, testShell).run(
			message(),
			CWD
		);

		expect(listResults[0].ok).toBe(false);
		expect(listResults[0].reason).toContain('not fully merged');
		expect(changed).toBe(false);
		expect(recorded.listErrors.join(' ')).toContain('no branches were deleted');
	});

	it('tells the user how many of the batch survived', async () => {
		const git = new FakeGit({ 'rev-parse --verify refs/heads/keep': `${TIP}\n` });

		await new BranchCleanupService(git, testShell).run(
			message({ listNames: ['moved', 'keep'], mapExpectedTips: { moved: TIP, keep: TIP } }),
			CWD
		);

		expect(recorded.listInfo.join(' ')).toContain('deleted 1 of 2 branches');
	});
});
