import type { HostToWebview } from '@git-octopus/shared';
import { pathExists } from '../../adapters/fs/pathExists.js';
import {
	getAheadBehind,
	getCurrentBranch,
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
	const [working, aheadBehind, repoState, currentBranch, headHash] = await Promise.all([
		getStatus(ctx.executor, ctx.cwd),
		getAheadBehind(ctx.executor, ctx.cwd),
		getRepoState(ctx.executor, ctx.cwd, pathExists),
		getCurrentBranch(ctx.executor, ctx.cwd),
		getHeadHash(ctx.executor, ctx.cwd),
	]);
	const changeCount = working.staged.length + working.unstaged.length;
	return {
		type: 'statusUpdate',
		working: changeCount > 0 ? working : null,
		changeCount,
		ahead: aheadBehind.ahead,
		behind: aheadBehind.behind,
		repoState,
		currentBranch,
		headHash,
	};
}
