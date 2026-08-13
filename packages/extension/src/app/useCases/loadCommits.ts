import type { HostToWebview } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { getCommits } from '../../core/git/gitService.js';

export interface RepoContext {
	executor: GitExecutor;
	cwd: string | null;
	repoName: string | null;
}

/** Load commits for the open repository, mapping success/failure to a webview message. */
export async function loadCommits(ctx: RepoContext, limit: number): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return { type: 'error', message: 'No Git repository is open in this workspace.' };
	}
	try {
		const commits = await getCommits(ctx.executor, ctx.cwd, limit);
		return { type: 'commits', repoName: ctx.repoName, commits };
	} catch (err) {
		return { type: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}
