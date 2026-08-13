import type { GraphFilters, HostToWebview, WebviewToHost } from '@git-octopus/shared';
import { loadCommits, type RepoContext } from './useCases/loadCommits.js';
import { loadCommitDetails } from './useCases/loadCommitDetails.js';
import { loadComparison } from './useCases/loadComparison.js';

const DEFAULT_LIMIT = 300;

/**
 * Map an inbound webview message to an optional reply, dispatching to use-cases.
 * Side-effecting messages (diffs, actions, repo selection) are handled by the adapter layer.
 */
export function routeMessage(
	message: WebviewToHost,
	ctx: RepoContext,
	filters: GraphFilters
): Promise<HostToWebview | undefined> {
	switch (message.type) {
		case 'ready':
			return loadCommits(ctx, DEFAULT_LIMIT, filters);
		case 'loadCommits':
			return loadCommits(ctx, message.limit, message.filters ?? filters);
		case 'loadCommitDetails':
			return loadCommitDetails(ctx, message.hash);
		case 'loadComparison':
			return loadComparison(ctx, message.fromHash, message.toHash);
		default:
			return Promise.resolve(undefined);
	}
}
