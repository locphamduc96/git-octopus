import type { HostToWebview, LoadCommitStatsMessage } from '@git-octopus/shared';
import { getCommitStats } from '../../core/git/commitStats.js';
import type { RepoContext } from './loadCommits.js';

/** The Changes column is decoration: a failure leaves its cells empty rather than raising a toast. */
export async function loadCommitStats(
	ctx: RepoContext,
	message: LoadCommitStatsMessage
): Promise<HostToWebview> {
	if (!ctx.cwd) return { type: 'commitStats', listStats: [] };
	try {
		return {
			type: 'commitStats',
			listStats: await getCommitStats(ctx.executor, ctx.cwd, message.listHashes),
		};
	} catch {
		return { type: 'commitStats', listStats: [] };
	}
}
