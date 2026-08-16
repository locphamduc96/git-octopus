import type { HostToWebview, LoadFileDiffMessage } from '@git-octopus/shared';
import { countDiffLines } from '../../core/git/diffParser.js';
import { getFileDiff } from '../../core/git/gitService.js';
import type { RepoContext } from './loadCommits.js';

/**
 * A ceiling on what the view is asked to draw. The whole-file mode asks git for more context than
 * any file has, so a generated bundle would otherwise arrive as one hunk of a hundred thousand
 * lines — cheap for git, and the thing that would make the webview stutter.
 */
const MAX_LINES = 20000;

/** Load one file's diff as hunks, for the in-view diff panel. */
export async function loadFileDiff(
	ctx: RepoContext,
	message: LoadFileDiffMessage
): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return {
			type: 'error',
			message: 'No Git repository is open in this workspace.',
			repos: ctx.repos,
			activeRepo: null,
			source: 'loadFileDiff',
		};
	}
	const result = await getFileDiff(ctx.executor, ctx.cwd, {
		path: message.path,
		oldPath: message.oldPath,
		hash: message.hash,
		fromHash: message.fromHash,
		toHash: message.toHash,
		untracked: message.untracked,
		context: message.context,
	});
	const total = countDiffLines(result.listHunks);
	if (total > MAX_LINES) {
		return {
			type: 'fileDiff',
			key: message.key,
			path: message.path,
			listHunks: [],
			notice: `This diff is ${total.toLocaleString()} lines — too large to draw here. Switch to changes only, or open it in the editor.`,
		};
	}
	return {
		type: 'fileDiff',
		key: message.key,
		path: message.path,
		listHunks: result.listHunks,
		notice: result.notice,
	};
}
