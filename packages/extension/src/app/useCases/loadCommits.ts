import type { Commit, GraphFilters, HostToWebview, RepoInfo } from '@git-octopus/shared';
import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	getAheadBehind,
	getBranches,
	getCommits,
	getCurrentBranch,
	getHeadHash,
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
		const listStashes = await getStashes(ctx.executor, ctx.cwd);
		const [commits, working, headHash, listBranches, currentBranch, aheadBehind] =
			await Promise.all([
				getCommits(
					ctx.executor,
					ctx.cwd,
					limit,
					filters,
					listStashes.map((stash) => stash.hash)
				),
				getStatus(ctx.executor, ctx.cwd),
				getHeadHash(ctx.executor, ctx.cwd),
				getBranches(ctx.executor, ctx.cwd),
				getCurrentBranch(ctx.executor, ctx.cwd),
				getAheadBehind(ctx.executor, ctx.cwd),
			]);

		decorateStashes(commits, listStashes);
		if (filters.fetchAvatars && ctx.avatarUrl) {
			for (const commit of commits) {
				if (commit.author.email !== '') {
					commit.author.avatarUrl = ctx.avatarUrl(commit.author.email);
				}
			}
		}
		const dirty = working.staged.length > 0 || working.unstaged.length > 0;
		const listCommits = dirty ? [makeUncommittedNode(headHash), ...commits] : commits;
		return {
			type: 'commits',
			commits: listCommits,
			working: dirty ? working : null,
			repos: ctx.repos,
			activeRepo: ctx.cwd,
			repoName: ctx.repoName,
			listBranches,
			currentBranch,
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
 * Tag stash commits with a stash ref. Their 2nd/3rd parents hold the index and untracked snapshots,
 * which are internal to git — dropping them keeps the graph readable.
 */
function decorateStashes(listCommits: Commit[], listStashes: StashEntry[]): void {
	if (listStashes.length === 0) return;
	const mapStashByHash = new Map(listStashes.map((stash) => [stash.hash, stash.name]));
	for (const commit of listCommits) {
		const name = mapStashByHash.get(commit.hash);
		if (!name) continue;
		commit.refs = [...commit.refs, { kind: 'stash', name }];
		commit.parents = commit.parents.slice(0, 1);
	}
}

function makeUncommittedNode(headHash: string | null): Commit {
	return {
		hash: UNCOMMITTED_HASH,
		parents: headHash ? [headHash] : [],
		author: { name: '', email: '' },
		committedAt: Math.floor(Date.now() / 1000),
		subject: 'Uncommitted Changes',
		refs: [],
		isUncommitted: true,
	};
}
