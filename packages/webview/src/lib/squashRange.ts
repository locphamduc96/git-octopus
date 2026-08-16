import type { Commit, GraphRow } from '@git-octopus/shared';

/**
 * The hashes covered by a shift-click: everything between the anchor row and the target row in
 * display order (newest first). The synthetic uncommitted node and stashes can never be part of a
 * squash, so they are dropped rather than invalidating the whole range.
 */
export function selectRange(
	listRows: GraphRow[],
	anchorHash: string | null,
	targetHash: string
): string[] {
	const target = listRows.findIndex((row) => row.commit.hash === targetHash);
	if (target === -1) return [];
	const anchor = anchorHash ? listRows.findIndex((row) => row.commit.hash === anchorHash) : -1;
	if (anchor === -1) return [targetHash];
	const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
	return listRows
		.slice(from, to + 1)
		.filter(
			(row) => !row.commit.isUncommitted && !row.commit.refs.some((ref) => ref.kind === 'stash')
		)
		.map((row) => row.commit.hash);
}

/**
 * Whether the commits (newest → oldest) can be squashed as one unit: every commit has exactly one
 * parent — so no merges and no root commit — and each one's parent is the next in the list, i.e.
 * the run is contiguous on a single first-parent line.
 */
export function isSquashableChain(listCommits: Commit[]): boolean {
	if (listCommits.length < 2) return false;
	for (let index = 0; index < listCommits.length; index++) {
		const commit = listCommits[index];
		if (commit.parents.length !== 1) return false;
		const older = listCommits[index + 1];
		if (older && commit.parents[0] !== older.hash) return false;
	}
	return true;
}
