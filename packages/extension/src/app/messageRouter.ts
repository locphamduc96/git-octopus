import type { GraphFilters, HostToWebview, WebviewToHost } from '@git-octopus/shared';
import { loadCommits, type RepoContext } from './useCases/loadCommits.js';
import { loadCommitDetails } from './useCases/loadCommitDetails.js';
import { loadComparison } from './useCases/loadComparison.js';
import { loadFileDiff } from './useCases/loadFileDiff.js';

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
		case 'loadCommits':
			return loadCommits(ctx, message.limit, message.filters ?? filters);
		case 'loadCommitDetails':
			return loadCommitDetails(ctx, message.hash, filters.fetchAvatars);
		case 'loadComparison':
			return loadComparison(ctx, message.fromHash, message.toHash);
		case 'loadFileDiff':
			return loadFileDiff(ctx, message);
		default:
			// Deliberately non-exhaustive: `undefined` means "not my job", and the controller's switch
			// — which does answer for every member — is where a new message type is caught.
			return Promise.resolve(undefined);
	}
}
