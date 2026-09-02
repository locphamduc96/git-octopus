import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { getCommitDetails } from './gitService';

const HASH = 'abc1234';

/** `%H %P %an %ae %at %cn %ce %ct %B`, NUL-separated — the order the destructure depends on. */
function meta(body: string, parents = 'p1'): string {
	return [
		'abc1234full',
		parents,
		'Ada Lovelace',
		'ada@example.com',
		'1700000000',
		'Grace Hopper',
		'grace@example.com',
		'1700000060',
		body,
	].join('\0');
}

function gitWith(options: { meta: string; nameStatus?: string; numstat?: string }) {
	return fakeGit({
		'show -s': options.meta,
		'diff-tree --no-commit-id --name-status': options.nameStatus ?? '',
		'diff-tree --no-commit-id --numstat': options.numstat ?? '',
	});
}

describe('getCommitDetails', () => {
	it('reads the nine metadata fields in the order the format writes them', async () => {
		// A shift by one shows up as the author's email sitting in the timestamp, which every
		// downstream consumer then renders as NaN rather than failing loudly.
		const details = await getCommitDetails(gitWith({ meta: meta('subject') }), '/repo', HASH);

		expect(details.hash).toBe('abc1234full');
		expect(details.author).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
		expect(details.authoredAt).toBe(1700000000);
		expect(details.committer).toEqual({ name: 'Grace Hopper', email: 'grace@example.com' });
		expect(details.committedAt).toBe(1700000060);
	});

	it('keeps a literal NUL inside the body instead of truncating there', async () => {
		// The body is the last field, so everything past field eight is re-joined rather than
		// treated as another field.
		const details = await getCommitDetails(gitWith({ meta: meta('first\0second') }), '/repo', HASH);

		expect(details.body).toBe('first\0second');
	});

	it('strips the trailing newlines git leaves on the message', async () => {
		const details = await getCommitDetails(
			gitWith({ meta: meta('subject\n\nbody\n\n\n') }),
			'/repo',
			HASH
		);

		expect(details.body).toBe('subject\n\nbody');
	});

	it('splits both parents of a merge and reports none for a root commit', async () => {
		const merge = await getCommitDetails(gitWith({ meta: meta('m', 'p1 p2') }), '/repo', HASH);
		expect(merge.parents).toEqual(['p1', 'p2']);

		const root = await getCommitDetails(gitWith({ meta: meta('r', '') }), '/repo', HASH);
		expect(root.parents).toEqual([]);
	});

	it('merges the line counts onto a renamed file, whose two commands spell the path differently', async () => {
		// name-status reports `R100\told\tnew`; numstat reports the single string `old => new`.
		// If the reconstructed key ever stops matching, every renamed file silently shows 0/0.
		const details = await getCommitDetails(
			gitWith({
				meta: meta('rename'),
				nameStatus: 'R100\tsrc/old.ts\tsrc/new.ts\n',
				numstat: '4\t2\tsrc/{old.ts => new.ts}\n',
			}),
			'/repo',
			HASH
		);

		expect(details.files).toEqual([
			{
				status: 'R',
				oldPath: 'src/old.ts',
				path: 'src/new.ts',
				additions: 4,
				deletions: 2,
			},
		]);
	});

	it('merges counts onto an ordinary modified file', async () => {
		const details = await getCommitDetails(
			gitWith({
				meta: meta('edit'),
				nameStatus: 'M\tsrc/a.ts\n',
				numstat: '7\t1\tsrc/a.ts\n',
			}),
			'/repo',
			HASH
		);

		expect(details.files[0]).toEqual({
			status: 'M',
			path: 'src/a.ts',
			additions: 7,
			deletions: 1,
		});
	});

	it('lists a file numstat said nothing about, rather than dropping it', async () => {
		// A binary file reports `-` for both counts; it still belongs in the file list.
		const details = await getCommitDetails(
			gitWith({
				meta: meta('binary'),
				nameStatus: 'A\tlogo.png\n',
				numstat: '-\t-\tlogo.png\n',
			}),
			'/repo',
			HASH
		);

		expect(details.files[0].path).toBe('logo.png');
		expect(details.files[0].additions).toBe(0);
	});

	it('walks a root commit too, so the first commit in history has a file list', async () => {
		const git = gitWith({ meta: meta('first', '') });
		await getCommitDetails(git, '/repo', HASH);

		// Asserted before the loop: a rename of the command would empty it and pass silently.
		expect(git.callsTo('diff-tree')).toHaveLength(2);
		for (const argv of git.callsTo('diff-tree')) {
			expect(argv).toContain('--root');
			expect(argv).toContain('-r');
		}
	});
});
