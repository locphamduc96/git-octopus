import type { Commit, GraphFilters, HostToWebview, RepoInfo } from '@git-octopus/shared';
import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { pathExists } from '../../adapters/fs/pathExists.js';
import {
	getAheadBehind,
	getBranchEntries,
	getCommits,
	getCurrentBranch,
	getHeadHash,
	getRepoState,
	getStashes,
	getStatus,
	type StashEntry,
} from '../../core/git/gitService.js';

export interface RepoContext {
	executor: GitExecutor;
	/** Repositories discovered in the workspace. */
	repos: RepoInfo[];
	/** Absolute path of the repository currently shown, or null when none was found. */
	cwd: string | null;
	repoName: string | null;
	/** Builds an avatar URL for an email; injected so `core` stays free of network concerns. */
	avatarUrl?: (email: string) => string;
}

const DEFAULT_FILTERS: GraphFilters = { branch: null, showRemoteBranches: true };

/** Load commits, working tree and branch list for the active repository. */
export async function loadCommits(
	ctx: RepoContext,
	limit: number,
	filters: GraphFilters = DEFAULT_FILTERS
): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return {
			type: 'error',
			message: 'No Git repository was found in this workspace.',
			repos: ctx.repos,
			activeRepo: null,
		};
	}
	try {
		const listStashes =
			(filters.showStashes ?? true) ? await getStashes(ctx.executor, ctx.cwd) : [];
		// One commit past the limit answers "is there more?" without a second log walk.
		const [
			listRaw,
			working,
			headHash,
			listLocal,
			listRemote,
			currentBranch,
			aheadBehind,
			repoState,
		] = await Promise.all([
			getCommits(
				ctx.executor,
				ctx.cwd,
				limit + 1,
				filters,
				listStashes.map((stash) => stash.hash)
			),
			getStatus(ctx.executor, ctx.cwd),
			getHeadHash(ctx.executor, ctx.cwd),
			getBranchEntries(ctx.executor, ctx.cwd, 'refs/heads'),
			getBranchEntries(ctx.executor, ctx.cwd, 'refs/remotes'),
			getCurrentBranch(ctx.executor, ctx.cwd),
			getAheadBehind(ctx.executor, ctx.cwd),
			getRepoState(ctx.executor, ctx.cwd, pathExists),
		]);

		const hasMore = listRaw.length > limit;
		const listHistory = applyStashes(listRaw.slice(0, limit), listStashes);
		if (filters.fetchAvatars && ctx.avatarUrl) {
			for (const commit of listHistory) {
				if (commit.author.email !== '') {
					commit.author.avatarUrl = ctx.avatarUrl(commit.author.email);
				}
			}
		}
		const changeCount = working.staged.length + working.unstaged.length;
		// `working` is still sent either way — the changes panel needs it even when the graph
		// does not show the synthetic node.
		const listCommits =
			changeCount > 0 && (filters.showUncommitted ?? true)
				? [makeUncommittedNode(headHash, changeCount), ...listHistory]
				: listHistory;
		return {
			type: 'commits',
			// Echo what the walk was run with, so a view can recognise and drop a stale answer.
			limit,
			filters,
			commits: listCommits,
			working: changeCount > 0 ? working : null,
			repoState,
			hasMore,
			repos: ctx.repos,
			activeRepo: ctx.cwd,
			repoName: ctx.repoName,
			listBranches: [
				...listLocal.map((entry) => ({ name: entry.name, hash: entry.hash, remote: false })),
				...listRemote.map((entry) => ({ name: entry.name, hash: entry.hash, remote: true })),
			],
			currentBranch,
			headHash,
			ahead: aheadBehind.ahead,
			behind: aheadBehind.behind,
		};
	} catch (err) {
		return {
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
			repos: ctx.repos,
			activeRepo: ctx.cwd,
		};
	}
}

/**
 * Label stash commits and hide git's stash plumbing.
 *
 * A stash commit has up to three parents: the commit that was checked out, a snapshot of the index,
 * and a snapshot of the untracked files. Only the first is real history — the other two are commits
 * git creates for its own bookkeeping, so they are dropped from both the parent list and the graph.
 */
function applyStashes(listCommits: Commit[], listStashes: StashEntry[]): Commit[] {
	if (listStashes.length === 0) return listCommits;

	const mapStashByHash = new Map(listStashes.map((stash) => [stash.hash, stash.name]));
	const setSnapshots = new Set<string>();

	for (const commit of listCommits) {
		const name = mapStashByHash.get(commit.hash);
		if (!name) continue;
		commit.refs = [...commit.refs, { kind: 'stash', name }];
		for (const parent of commit.parents.slice(1)) setSnapshots.add(parent);
		commit.parents = commit.parents.slice(0, 1);
	}

	// Keep a snapshot commit if some ref points at it, so nothing referenced ever disappears.
	return listCommits.filter((commit) => !setSnapshots.has(commit.hash) || commit.refs.length > 0);
}

function makeUncommittedNode(headHash: string | null, changeCount: number): Commit {
	const now = Math.floor(Date.now() / 1000);
	return {
		hash: UNCOMMITTED_HASH,
		parents: headHash ? [headHash] : [],
		author: { name: '', email: '' },
		committedAt: now,
		authoredAt: now,
		subject: `Uncommitted Changes (${changeCount})`,
		refs: [],
		isUncommitted: true,
	};
}
