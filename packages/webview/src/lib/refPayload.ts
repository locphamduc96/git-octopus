import type { Commit, RemoteBranchRef } from '@git-octopus/shared';
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

/**
 * The ref lists for an action aimed at the whole commit — every ref it carries, in the order git
 * reported them. This is the unnarrowed counterpart of {@link buildRefPayload}: the host may find
 * more than one entry in a list and ask the user which one was meant.
 *
 * A branch ref carrying a remote is a remote branch and only that: the two lists must not overlap,
 * or the host would see the same branch twice and ask a question with one real answer.
 */
export function commitRefPayload(commit: Commit): RefPayload {
	const payload: RefPayload = { listBranches: [], listRemoteBranches: [], listTags: [] };
	for (const ref of commit.refs) {
		if (ref.kind === 'tag') payload.listTags.push(ref.name);
		if (ref.kind !== 'branch') continue;
		// A branch whose remote is empty rather than absent has no remote to act on, so it counts
		// as local — the alternative is a remote entry naming no remote, which git cannot use.
		if (ref.remote) payload.listRemoteBranches.push({ remote: ref.remote, branch: ref.name });
		else payload.listBranches.push(ref.name);
	}
	return payload;
}

/** The stash a commit stands for, when it stands for one. */
export function commitStashName(commit: Commit): string | undefined {
	for (const ref of commit.refs) if (ref.kind === 'stash') return ref.name;
	return undefined;
}
