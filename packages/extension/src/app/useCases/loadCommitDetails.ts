import type { HostToWebview } from '@git-octopus/shared';
import { getCommitDetails } from '../../core/git/gitService.js';
import type { RepoContext } from './loadCommits.js';

/** Load details for a single commit, mapping success/failure to a webview message. */
export async function loadCommitDetails(ctx: RepoContext, hash: string): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return {
			type: 'error',
			message: 'No Git repository is open in this workspace.',
			repos: ctx.repos,
			activeRepo: null,
		};
	}
	try {
		const details = await getCommitDetails(ctx.executor, ctx.cwd, hash);
		return { type: 'commitDetails', details };
	} catch (err) {
		return {
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
			repos: ctx.repos,
			activeRepo: ctx.cwd,
		};
	}
}
