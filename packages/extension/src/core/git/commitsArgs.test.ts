import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { getCommits } from './gitService';

/**
 * The refs `git log` is pointed at, and in what order. `parseLog` happily parses whatever it is
 * handed, so a wrong ref set is invisible to every parser test — the graph just quietly shows a
 * different set of commits than the filters asked for.
 */
async function argvFor(
	filters: Parameters<typeof getCommits>[3],
	listExtraRevs: string[] = []
): Promise<string[]> {
	const git = fakeGit();
	await getCommits(git, '/repo', 50, filters, listExtraRevs);
	return git.listCalls[0];
}

describe('getCommits argv', () => {
	it('walks branches, HEAD, remotes and tags when nothing is filtered out', async () => {
		const argv = await argvFor({ branch: null, showRemoteBranches: true });

		expect(argv).toContain('--branches');
		expect(argv).toContain('HEAD');
		expect(argv).toContain('--remotes');
		expect(argv).toContain('--tags');
	});

	it('walks a filtered branch alone, with no other ref selector alongside it', async () => {
		// The whole point of the filter: adding `--branches` back would re-widen the walk to
		// everything while the UI still claims one branch is selected.
		const argv = await argvFor({ branch: 'refs/heads/feature', showRemoteBranches: true });

		expect(argv).toContain('refs/heads/feature');
		expect(argv).not.toContain('--branches');
		expect(argv).not.toContain('--remotes');
		expect(argv).not.toContain('--tags');
		expect(argv).not.toContain('HEAD');
	});

	it('drops --remotes when remote branches are hidden', async () => {
		const argv = await argvFor({ branch: null, showRemoteBranches: false });

		expect(argv).not.toContain('--remotes');
		expect(argv).toContain('--branches');
	});

	it('shows tags unless they are explicitly turned off', async () => {
		expect(await argvFor({ branch: null, showRemoteBranches: true })).toContain('--tags');
		expect(
			await argvFor({ branch: null, showRemoteBranches: true, showTags: false })
		).not.toContain('--tags');
	});

	it('maps each commit order onto its own git flag', async () => {
		const base = { branch: null, showRemoteBranches: true } as const;

		expect(await argvFor({ ...base })).toContain('--date-order');
		expect(await argvFor({ ...base, commitOrder: 'date' })).toContain('--date-order');
		expect(await argvFor({ ...base, commitOrder: 'authorDate' })).toContain('--author-date-order');
		expect(await argvFor({ ...base, commitOrder: 'topo' })).toContain('--topo-order');
	});

	it('places extra revisions after the refs, where a stash commit is still reachable', async () => {
		const argv = await argvFor({ branch: null, showRemoteBranches: true }, ['stash1', 'stash2']);

		expect(argv.indexOf('stash1')).toBeGreaterThan(argv.indexOf('--tags'));
		expect(argv.indexOf('stash2')).toBe(argv.indexOf('stash1') + 1);
		expect(argv.indexOf('stash2')).toBeLessThan(argv.indexOf('--date-order'));
	});

	it('caps the walk at the requested limit', async () => {
		const git = fakeGit();
		await getCommits(git, '/repo', 250, { branch: null, showRemoteBranches: true });

		const argv = git.listCalls[0];
		expect(argv[argv.indexOf('-n') + 1]).toBe('250');
	});

	it('asks for full ref paths so a local branch is never read as a remote one', async () => {
		const argv = await argvFor({ branch: null, showRemoteBranches: true });

		expect(argv).toContain('--decorate=full');
	});
});
