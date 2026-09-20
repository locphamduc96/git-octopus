import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit.js';
import { getCurrentBranch } from './gitService.js';

describe('getCurrentBranch', () => {
	it('names the branch from rev-parse when HEAD resolves', async () => {
		const git = fakeGit({ 'rev-parse --abbrev-ref': 'main\n' });

		expect(await getCurrentBranch(git, '/repo')).toBe('main');
		expect(git.ran('symbolic-ref')).toBe(false);
	});

	it('falls back to symbolic-ref for a branch that has no commits yet', async () => {
		// `rev-parse` has to resolve HEAD to a commit before it can name it, so it fails on an
		// unborn branch. Answering null there drew "detached HEAD" over a repository sitting on
		// `main` — the opposite state.
		const git = fakeGit({ 'symbolic-ref': 'main\n' }).rejectOn(
			'rev-parse --abbrev-ref',
			"fatal: ambiguous argument 'HEAD'"
		);

		expect(await getCurrentBranch(git, '/repo')).toBe('main');
	});

	it('returns null when HEAD really is detached', async () => {
		// Detached is the one case with no name to give: rev-parse says the literal "HEAD", and
		// symbolic-ref fails because HEAD points at a commit rather than a ref.
		const git = fakeGit({ 'rev-parse --abbrev-ref': 'HEAD\n' }).rejectOn(
			'symbolic-ref',
			'fatal: ref HEAD is not a symbolic ref'
		);

		expect(await getCurrentBranch(git, '/repo')).toBeNull();
	});

	it('returns null when neither command answers', async () => {
		const git = fakeGit().rejectOn('rev-parse').rejectOn('symbolic-ref');

		expect(await getCurrentBranch(git, '/repo')).toBeNull();
	});
});
