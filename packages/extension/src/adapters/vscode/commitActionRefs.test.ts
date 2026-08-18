import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommitActionMessage } from '@git-octopus/shared';
import { recorded, resetRecorded } from '../../test/vscodeStub';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { GitProcessExecutor } from '../process/gitProcessExecutor';
import type { UserPrompt } from '../../app/ports/userPrompt';
import { CommitActionService } from './CommitActionService';

/** Answers every prompt the same way, and records what it was asked. */
function promptAnswering(confirmed: boolean): UserPrompt & { listTitles: string[] } {
	const listTitles: string[] = [];
	return {
		listTitles,
		confirm: (request) => {
			listTitles.push(request.message);
			return Promise.resolve(confirmed);
		},
		pickOptions: (request) => {
			listTitles.push(request.title);
			return Promise.resolve(request.listOptions.map((option) => option.id));
		},
		inputText: (request) => {
			listTitles.push(request.title);
			return Promise.resolve('');
		},
	};
}

function message(over: Partial<CommitActionMessage>): CommitActionMessage {
	return {
		type: 'commitAction',
		repoPath: '',
		action: 'copyRefName',
		hash: '',
		subject: '',
		branches: [],
		remoteBranches: [],
		...over,
	};
}

describe('ref-scoped commit actions against a real repository', () => {
	let repo: TempRepo;
	let actions: CommitActionService;
	let first = '';
	let second = '';

	beforeAll(async () => {
		repo = await createTempRepo();
		actions = new CommitActionService(new GitProcessExecutor());
		first = await repo.commit('a.txt', 'one\n', 'first');
		second = await repo.commit('b.txt', 'two\n', 'second');
	});

	afterAll(async () => {
		await repo.dispose();
	});

	beforeEach(() => {
		resetRecorded();
	});

	describe('copyRefName', () => {
		it('copies the local branch name when the payload names one', async () => {
			await actions.run(
				message({ action: 'copyRefName', branches: ['feature'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(recorded.listClipboard).toEqual(['feature']);
		});

		it('copies a remote-tracking name in the form the chip showed it', async () => {
			await actions.run(
				message({
					action: 'copyRefName',
					remoteBranches: [{ remote: 'upstream', branch: 'feature' }],
				}),
				repo.cwd,
				promptAnswering(true)
			);
			expect(recorded.listClipboard).toEqual(['upstream/feature']);
		});

		it('copies a tag, and does not ask for a refresh', async () => {
			const changed = await actions.run(
				message({ action: 'copyRefName', tags: ['v1'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(recorded.listClipboard).toEqual(['v1']);
			expect(changed).toBe(false);
		});

		it('does nothing when the payload carries no ref', async () => {
			await actions.run(message({ action: 'copyRefName' }), repo.cwd, promptAnswering(true));
			expect(recorded.listClipboard).toEqual([]);
		});
	});

	describe('stale-ref guard', () => {
		it('deletes a branch that still stands where the menu drew it', async () => {
			await repo.git('branch', 'doomed', second);
			const changed = await actions.run(
				message({ action: 'deleteBranch', hash: second, branches: ['doomed'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(true);
			await expect(repo.git('rev-parse', '--verify', 'refs/heads/doomed')).rejects.toThrow();
		});

		it('refuses a branch that moved after the menu was built', async () => {
			await repo.git('branch', 'moved', first);
			const changed = await actions.run(
				// The menu was opened while `moved` sat at `second`; it is at `first` by the time the
				// user clicks.
				message({ action: 'deleteBranch', hash: second, branches: ['moved'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(false);
			expect(recorded.listErrors.join(' ')).toMatch(/no longer points at/);
			// The branch is still there, and the user was never asked to confirm.
			expect((await repo.git('rev-parse', 'refs/heads/moved')).trim()).toBe(first);
		});

		it('refuses a branch that was deleted out from under the menu', async () => {
			const changed = await actions.run(
				message({ action: 'deleteBranch', hash: second, branches: ['never-existed'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(false);
			expect(recorded.listErrors.join(' ')).toMatch(/no longer points at/);
		});

		it('refuses a tag that was force-moved to another commit', async () => {
			await repo.git('tag', '-f', 'v-moved', first);
			const changed = await actions.run(
				message({ action: 'deleteTag', hash: second, tags: ['v-moved'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(false);
			expect((await repo.git('rev-parse', 'refs/tags/v-moved^{commit}')).trim()).toBe(first);
		});

		it('compares an annotated tag by the commit it names', async () => {
			await repo.git('tag', '-a', 'v-annotated', '-m', 'note', second);
			const changed = await actions.run(
				message({ action: 'deleteTag', hash: second, tags: ['v-annotated'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(true);
		});

		it('skips the guard for an action raised with no commit in mind', async () => {
			await repo.git('branch', 'from-tree', first);
			const changed = await actions.run(
				// What the repository tree sends: a ref name and an empty hash.
				message({ action: 'deleteBranch', hash: '', branches: ['from-tree'] }),
				repo.cwd,
				promptAnswering(true)
			);
			expect(changed).toBe(true);
		});
	});
});
