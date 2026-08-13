import type { Commit, HostToWebview } from '@git-octopus/shared';
import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { getCommits, getHeadHash, getStatus } from '../../core/git/gitService.js';

export interface RepoContext {
	executor: GitExecutor;
	cwd: string | null;
	repoName: string | null;
}

/** Load commits + working tree for the open repository, mapping to a webview message. */
export async function loadCommits(ctx: RepoContext, limit: number): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return { type: 'error', message: 'No Git repository is open in this workspace.' };
	}
	try {
		const [commits, working, headHash] = await Promise.all([
			getCommits(ctx.executor, ctx.cwd, limit),
			getStatus(ctx.executor, ctx.cwd),
			getHeadHash(ctx.executor, ctx.cwd),
		]);
		const dirty = working.staged.length > 0 || working.unstaged.length > 0;
		const listCommits = dirty ? [makeUncommittedNode(headHash), ...commits] : commits;
		return {
			type: 'commits',
			repoName: ctx.repoName,
			commits: listCommits,
			working: dirty ? working : null,
		};
	} catch (err) {
		return { type: 'error', message: err instanceof Error ? err.message : String(err) };
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
