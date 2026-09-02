import type { GraphRow } from '@git-octopus/shared';

/**
 * The branch each drawn lane belongs to, read off the graph rather than asked of git.
 *
 * A commit with no chip of its own still sits on a line the layout already decided belongs to some
 * branch — that is what `nodeBranch` is. Walking the rows newest-first and taking the first branch
 * chip seen on each lane names it, and costs nothing: `git branch --contains` would be the honest
 * general answer, and it is a walk of the whole history per commit.
 *
 * The answer is therefore "the branch this row is drawn as part of", not "every branch containing
 * this commit". That is the weaker claim, and it is the one the graph is already making visually.
 */
export function mapLaneBranches(listRows: GraphRow[]): Record<number, string> {
	const mapNames: Record<number, string> = {};
	for (const row of listRows) {
		if (mapNames[row.nodeBranch] !== undefined) continue;
		for (const ref of row.commit.refs) {
			// Local branches only: a remote-tracking ref names the same line from the other side, and
			// showing `origin/main` as the ghost for a commit on `main` reads as a different branch.
			if (ref.kind === 'branch' && !ref.remote) {
				mapNames[row.nodeBranch] = ref.name;
				break;
			}
		}
	}
	return mapNames;
}

/**
 * What to draw faintly beside a commit that carries no chip: the branch its lane belongs to.
 *
 * Nothing when the commit has a chip of its own — the chip already says it, and a ghost repeating
 * it would read as a second, different ref.
 */
export function ghostBranchFor(row: GraphRow, mapNames: Record<number, string>): string | null {
	if (row.commit.refs.some((ref) => ref.kind === 'branch')) return null;
	return mapNames[row.nodeBranch] ?? null;
}
