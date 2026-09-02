import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { getFileDiff } from './gitService';

const UNTRACKED_DIFF = [
	'diff --git a/dev/null b/new.txt',
	'new file mode 100644',
	'--- /dev/null',
	'+++ b/new.txt',
	'@@ -0,0 +1,2 @@',
	'+a',
	'+b',
].join('\n');

const MODIFIED_DIFF = [
	'diff --git a/a.txt b/a.txt',
	'--- a/a.txt',
	'+++ b/a.txt',
	'@@ -1 +1 @@',
	'-old',
	'+new',
].join('\n');

/** The shared fake already refuses `--no-index` unless the caller whitelisted exit code 1. */
function noIndexExecutor() {
	return fakeGit({ 'diff --no-index': UNTRACKED_DIFF });
}

describe('getFileDiff', () => {
	it('reads an untracked file despite the exit code --no-index uses to report a difference', async () => {
		const result = await getFileDiff(noIndexExecutor(), '/repo', {
			path: 'new.txt',
			untracked: true,
			context: 3,
		});
		expect(result.notice).toBeUndefined();
		expect(result.listHunks).toHaveLength(1);
		expect(result.listHunks[0].listLines.map((line) => line.text)).toEqual(['a', 'b']);
	});
	it('diffs a range as from → to, with both revisions on the command line', async () => {
		const git = fakeGit({ diff: MODIFIED_DIFF });

		await getFileDiff(git, '/repo', {
			path: 'a.txt',
			fromHash: 'aaa',
			toHash: 'bbb',
			context: 3,
		});

		expect(git.listCalls[0]).toEqual(['diff', '-U3', 'aaa', 'bbb', '--', 'a.txt']);
	});

	it('diffs one commit with diff-tree, walking roots so the first commit still has a diff', async () => {
		const git = fakeGit({ 'diff-tree': MODIFIED_DIFF });

		await getFileDiff(git, '/repo', { path: 'a.txt', hash: 'abc', context: 3 });

		expect(git.listCalls[0]).toEqual([
			'diff-tree',
			'-p',
			'-r',
			'--root',
			'--no-commit-id',
			'-U3',
			'abc',
			'--',
			'a.txt',
		]);
	});

	it('turns rename detection on and names both paths, or git reports a whole-file add', async () => {
		const git = fakeGit({ diff: MODIFIED_DIFF });

		await getFileDiff(git, '/repo', {
			path: 'new.txt',
			oldPath: 'old.txt',
			fromHash: 'aaa',
			toHash: 'bbb',
			context: 3,
		});

		const argv = git.listCalls[0];
		expect(argv).toContain('-M');
		expect(argv.slice(argv.indexOf('--') + 1)).toEqual(['old.txt', 'new.txt']);
	});

	it('diffs the working tree against HEAD by default', async () => {
		const git = fakeGit({ diff: MODIFIED_DIFF });

		await getFileDiff(git, '/repo', { path: 'a.txt', context: 3 });

		expect(git.listCalls[0]).toEqual(['diff', 'HEAD', '-U3', '--', 'a.txt']);
	});

	it('falls back to the empty tree when HEAD does not exist yet', async () => {
		// A file staged in a repository with no first commit still deserves its diff.
		const git = fakeGit({ 'diff 4b825dc': MODIFIED_DIFF }).rejectOn(
			'diff HEAD',
			"fatal: ambiguous argument 'HEAD'"
		);

		const result = await getFileDiff(git, '/repo', { path: 'a.txt', context: 3 });

		expect(result.notice).toBeUndefined();
		expect(result.listHunks).toHaveLength(1);
		expect(git.listCalls[1]).toEqual([
			'diff',
			'4b825dc642cb6eb9a060e54bf8d69288fbee4904',
			'-U3',
			'--',
			'a.txt',
		]);
	});

	it('does not retry against the empty tree for a commit diff that failed', async () => {
		// Only the working-tree form can be missing a HEAD; anything else failing is a real error.
		const git = fakeGit().rejectOn('diff-tree', 'fatal: bad object');

		const result = await getFileDiff(git, '/repo', { path: 'a.txt', hash: 'abc', context: 3 });

		expect(result.notice).toBe('This file has no diff to show.');
		expect(git.listCalls).toHaveLength(1);
	});
});
