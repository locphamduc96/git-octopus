import type { RemoteBranchRef } from '@git-octopus/shared';
import type { RefTarget } from './graphMenu';

/** The ref lists a `commitAction` message carries, narrowed to one ref. */
export interface RefPayload {
	listBranches: string[];
	listRemoteBranches: RemoteBranchRef[];
	listTags: string[];
}

/**
 * The ref lists for an action aimed at exactly one ref.
 *
 * Built from the target rather than filtered out of the commit's refs: the host reads these lists
 * positionally (`branches[0]`, `remoteBranches[0]`) and asks the user whenever one holds more than
 * a single entry. A filter that let a second ref through would put that question back on screen,
 * which is the whole hazard this feature exists to remove.
 *
 * A target naming a remote is about that remote only, and leaves `branches` empty on purpose: the
 * host's `checkoutBranch` prefers a local name when it finds one, and here there is meant to be
 * none to prefer.
 */
export function buildRefPayload(target: RefTarget): RefPayload {
	const { chip, remote } = target;
	if (remote) {
		return {
			listBranches: [],
			listRemoteBranches: [{ remote, branch: chip.name }],
			listTags: [],
		};
	}
	if (chip.kind === 'tag')
		return { listBranches: [], listRemoteBranches: [], listTags: [chip.name] };
	if (chip.kind === 'branch' && chip.hasLocal)
		return { listBranches: [chip.name], listRemoteBranches: [], listTags: [] };
	return { listBranches: [], listRemoteBranches: [], listTags: [] };
}
