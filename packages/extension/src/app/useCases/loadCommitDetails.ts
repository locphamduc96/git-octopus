import type { HostToWebview } from '@git-octopus/shared';
import { getCommitDetails } from '../../core/git/gitService.js';
import type { RepoContext } from './loadCommits.js';

/** Load details for a single commit, mapping success/failure to a webview message. */
export async function loadCommitDetails(
	ctx: RepoContext,
	hash: string,
	fetchAvatars = false
): Promise<HostToWebview> {
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
		if (fetchAvatars && ctx.avatarUrl) {
			if (details.author.email) details.author.avatarUrl = ctx.avatarUrl(details.author.email);
			if (details.committer.email) {
				details.committer.avatarUrl = ctx.avatarUrl(details.committer.email);
			}
		}
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
