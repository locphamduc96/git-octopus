import type { HostToWebview } from '@git-octopus/shared';
import {
	getAheadBehind,
	getPreviousBranch,
	getHeadHash,
	getRepoState,
	getStatus,
} from '../../core/git/gitService.js';
import type { RepoContext } from './loadCommits.js';

/**
 * The cheap half of a refresh: what changed in the working tree, without walking history.
 *
 * A file being saved says nothing about the commit graph, so answering it with a full reload would
 * mean a `git log` over the whole loaded range for every keystroke-triggered save. This runs five
 * short commands instead of ten, and never re-lays-out the graph.
 */
export async function loadStatus(ctx: RepoContext): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return {
			type: 'error',
			message: 'No Git repository was found in this workspace.',
			repos: ctx.repos,
			activeRepo: null,
		};
	}
	try {
		const [status, aheadBehind, repoState, previousBranch, headHash] = await Promise.all([
			getStatus(ctx.executor, ctx.cwd),
			getAheadBehind(ctx.executor, ctx.cwd),
			getRepoState(ctx.executor, ctx.cwd, ctx.pathExists),
			getPreviousBranch(ctx.executor, ctx.cwd),
			getHeadHash(ctx.executor, ctx.cwd),
		]);
		const { working, isUnborn } = status;
		const changeCount = working.staged.length + working.unstaged.length;
		return {
			type: 'statusUpdate',
			working: changeCount > 0 ? working : null,
			changeCount,
			ahead: aheadBehind.ahead,
			behind: aheadBehind.behind,
			repoState,
			currentBranch: status.branch,
			isUnborn,
			previousBranch,
			headHash,
		};
	} catch (err) {
		// `getStatus` is the one call here that does not swallow its own failure, so a broken
		// `git status` used to reject out of this function. Callers run it with `void` — and one of
		// them chains `watcher.watch()` off it — so a rejection took the whole `.then` with it and
		// left the repository unwatched for the rest of the session.
		return {
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
			repos: ctx.repos,
			activeRepo: ctx.cwd,
		};
	}
}
