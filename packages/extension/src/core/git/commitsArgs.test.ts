import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { getCommits, withoutHiddenRefs } from './gitService';

/**
 * The refs `git log` is pointed at, and in what order. `parseLog` happily parses whatever it is
 * handed, so a wrong ref set is invisible to every parser test — the graph just quietly shows a
 * different set of commits than the filters asked for.
 */
async function argvFor(
	filters: Parameters<typeof getCommits>[3],
	listExtraRevs: string[] = [],
	headResolves = true
): Promise<string[]> {
	const git = fakeGit();
	await getCommits(git, '/repo', 50, filters, headResolves, listExtraRevs);
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

	it('leaves HEAD out when it does not name a commit yet', async () => {
		// `HEAD` is a revision, so git fails the whole walk when it cannot be resolved — which is
		// every repository before its first commit. The patterns beside it match nothing and are
		// fine. Passing it anyway is what put `fatal: ambiguous argument 'HEAD'` on the graph.
		const argv = await argvFor({ branch: null, showRemoteBranches: true }, [], false);

		expect(argv).not.toContain('HEAD');
		expect(argv).toContain('--branches');
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
		await getCommits(git, '/repo', 250, { branch: null, showRemoteBranches: true }, true);

		const argv = git.listCalls[0];
		expect(argv[argv.indexOf('-n') + 1]).toBe('250');
	});

	it('asks for full ref paths so a local branch is never read as a remote one', async () => {
		const argv = await argvFor({ branch: null, showRemoteBranches: true });

		expect(argv).toContain('--decorate=full');
	});

	it('puts each hidden ref right before the pattern of its own namespace', async () => {
		const argv = await argvFor({
			branch: null,
			showRemoteBranches: true,
			hiddenRefs: {
				listBranches: ['feature/x'],
				listRemotes: ['origin/feature/x'],
				listTags: ['v1'],
			},
		});
		const at = (token: string) => argv.indexOf(token);
		expect(at('--exclude=feature/x')).toBe(at('--branches') - 1);
		expect(at('--exclude=origin/feature/x')).toBe(at('--remotes') - 1);
		expect(at('--exclude=v1')).toBe(at('--tags') - 1);
	});

	it('walks every solo ref and nothing else', async () => {
		const argv = await argvFor({
			branch: 'main',
			listSoloRefs: ['main', 'origin/feature'],
			showRemoteBranches: true,
		});
		expect(argv).toContain('main');
		expect(argv).toContain('origin/feature');
		expect(argv).not.toContain('--branches');
		expect(argv).not.toContain('HEAD');
	});
});

describe('withoutHiddenRefs', () => {
	it('drops the chips of hidden branches, remote branches and tags, and keeps the rest', () => {
		const commit = {
			hash: 'a',
			parents: [],
			author: { name: 'A', email: 'a@example.com' },
			committedAt: 0,
			authoredAt: 0,
			subject: 's',
			refs: [
				{ kind: 'head' as const },
				{ kind: 'branch' as const, name: 'main' },
				{ kind: 'branch' as const, name: 'feature' },
				{ kind: 'branch' as const, name: 'feature', remote: 'origin' },
				{ kind: 'tag' as const, name: 'v1' },
			],
		};
		const [kept] = withoutHiddenRefs([commit], {
			listBranches: ['feature'],
			listRemotes: ['origin/feature'],
			listTags: ['v1'],
		});
		expect(kept.refs).toEqual([{ kind: 'head' }, { kind: 'branch', name: 'main' }]);
	});
});
