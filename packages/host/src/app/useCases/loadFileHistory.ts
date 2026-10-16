import type { HostToWebview, LoadFileHistoryMessage } from '@git-octopus/shared';
import { getFileHistory } from '../../core/git/fileHistory.js';
import type { RepoContext } from './loadCommits.js';

/** Read the commits that touched one file. A failure comes back on the reply, not as a toast. */
export async function loadFileHistory(
	ctx: RepoContext,
	message: LoadFileHistoryMessage
): Promise<HostToWebview> {
	const rev = message.rev ?? null;
	if (!ctx.cwd) {
		return {
			type: 'fileHistory',
			path: message.path,
			rev,
			listEntries: [],
			truncated: false,
			error: 'No Git repository is open in this workspace.',
		};
	}
	try {
		const history = await getFileHistory(ctx.executor, ctx.cwd, message.path, message.rev);
		return { type: 'fileHistory', path: message.path, rev, ...history };
	} catch (err) {
		return {
			type: 'fileHistory',
			path: message.path,
			rev,
			listEntries: [],
			truncated: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
