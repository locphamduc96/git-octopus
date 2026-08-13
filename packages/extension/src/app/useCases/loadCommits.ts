import type { Commit, GraphFilters, HostToWebview, RepoInfo } from '@git-octopus/shared';
import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	getAheadBehind,
	getBranches,
	getCommits,
	getCurrentBranch,
	getHeadHash,
	getStatus,
} from '../../core/git/gitService.js';

export interface RepoContext {
	executor: GitExecutor;
	/** Repositories discovered in the workspace. */
	repos: RepoInfo[];
	/** Absolute path of the repository currently shown, or null when none was found. */
	cwd: string | null;
	repoName: string | null;
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
		const [commits, working, headHash, listBranches, currentBranch, aheadBehind] =
			await Promise.all([
				getCommits(ctx.executor, ctx.cwd, limit, filters),
				getStatus(ctx.executor, ctx.cwd),
				getHeadHash(ctx.executor, ctx.cwd),
				getBranches(ctx.executor, ctx.cwd),
				getCurrentBranch(ctx.executor, ctx.cwd),
				getAheadBehind(ctx.executor, ctx.cwd),
			]);
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
