import { describe, expect, it } from 'vitest';
import { fakeGit, makeRepoContext } from '../../test/fakeGit.js';
import { loadCommits } from './loadCommits.js';

/** `git status --porcelain=v2 --branch` output for a repository that has no commits yet. */
const UNBORN_STATUS = ['# branch.oid (initial)', '# branch.head main', '? README.md', ''].join(
	'\0'
);

const BORN_STATUS = ['# branch.oid b69925a', '# branch.head main', ''].join('\0');

describe('loadCommits in a repository with no commits', () => {
	it('answers with a graph rather than an error', async () => {
		// The whole bug: `git log` was handed `HEAD`, which cannot resolve before the first commit,
		// so the walk failed and the reply became an error screen with git's stderr on it.
		const git = fakeGit({ status: UNBORN_STATUS });

		const reply = await loadCommits(makeRepoContext({ executor: git }), 50);

		expect(reply.type).toBe('commits');
	});

	it('shows the pending work as the only row, anchored to nothing', async () => {
		// There is no history to draw, but the files staged for the first commit are real. The
		// synthetic row carries no parent here — HEAD has no commit for it to hang off.
		const git = fakeGit({ status: UNBORN_STATUS });

		const reply = await loadCommits(makeRepoContext({ executor: git }), 50);

		const listCommits = reply.type === 'commits' ? reply.commits : [];
		expect(listCommits).toHaveLength(1);
		expect(listCommits[0]?.isUncommitted).toBe(true);
		expect(listCommits[0]?.parents).toEqual([]);
	});

	it('keeps HEAD out of the walk', async () => {
		const git = fakeGit({ status: UNBORN_STATUS });

		await loadCommits(makeRepoContext({ executor: git }), 50);

		const [argv] = git.callsTo('log');
		expect(argv).toBeDefined();
		expect(argv).not.toContain('HEAD');
		expect(argv).toContain('--branches');
	});

	it('reports the branch it is on, and flags it as unborn', async () => {
		const git = fakeGit({ status: UNBORN_STATUS });

		const reply = await loadCommits(makeRepoContext({ executor: git }), 50);

		expect(reply.type === 'commits' && reply.currentBranch).toBe('main');
		expect(reply.type === 'commits' && reply.isUnborn).toBe(true);
	});

	it('still lists the working-tree files, which are all there is to show', async () => {
		const git = fakeGit({ status: UNBORN_STATUS });

		const reply = await loadCommits(makeRepoContext({ executor: git }), 50);

		expect(reply.type === 'commits' && reply.working?.unstaged).toEqual([
			{ status: '?', path: 'README.md' },
		]);
	});

	it('puts HEAD back in the walk once the repository has a commit', async () => {
		const git = fakeGit({ status: BORN_STATUS });

		const reply = await loadCommits(makeRepoContext({ executor: git }), 50);

		expect(git.callsTo('log')[0]).toContain('HEAD');
		expect(reply.type === 'commits' && reply.isUnborn).toBe(false);
	});

	it('asks git for the branch name once, inside status', async () => {
		// `getCurrentBranch` used to run beside `status` in the same batch; the header `--branch`
		// adds answers the same question without a second process.
		const git = fakeGit({ status: BORN_STATUS });

		await loadCommits(makeRepoContext({ executor: git }), 50);

		expect(git.ranArgv('rev-parse --abbrev-ref HEAD')).toBe(false);
	});
});
