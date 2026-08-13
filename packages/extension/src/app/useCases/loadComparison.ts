import type { HostToWebview } from '@git-octopus/shared';
import { getComparison } from '../../core/git/gitService.js';
import type { RepoContext } from './loadCommits.js';

/** Compare two commits, mapping success/failure to a webview message. */
export async function loadComparison(
	ctx: RepoContext,
	fromHash: string,
	toHash: string
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
		const files = await getComparison(ctx.executor, ctx.cwd, fromHash, toHash);
		return { type: 'comparison', fromHash, toHash, files };
	} catch (err) {
		return {
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
			repos: ctx.repos,
			activeRepo: ctx.cwd,
		};
	}
}
