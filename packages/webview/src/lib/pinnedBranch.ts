import type { BranchRef, Commit } from '@git-octopus/shared';

/**
 * The commits the pinned branch's line runs through: its tip and every first parent below it that
 * is loaded. Empty when nothing is pinned, or the pinned branch is not in the graph right now.
 *
 * When the pinned branch is the one checked out, the Uncommitted row sits on top of its tip and is
 * part of the same line — so it is held on the left edge too.
 */
export function pinnedChain(
	listCommits: Commit[],
	listBranches: BranchRef[],
	pinnedRef: string | null
): Set<string> {
	const setChain = new Set<string>();
	if (!pinnedRef) return setChain;
	const tip = listBranches.find((branch) => branch.name === pinnedRef)?.hash;
	if (!tip) return setChain;
	const mapByHash = new Map(listCommits.map((commit) => [commit.hash, commit]));
	let hash: string | undefined = tip;
	while (hash !== undefined && mapByHash.has(hash) && !setChain.has(hash)) {
		setChain.add(hash);
		hash = mapByHash.get(hash)?.parents[0];
	}
	if (setChain.size === 0) return setChain;
	const uncommitted = listCommits.find((commit) => commit.isUncommitted);
	if (uncommitted && uncommitted.parents[0] === tip) setChain.add(uncommitted.hash);
	return setChain;
}
