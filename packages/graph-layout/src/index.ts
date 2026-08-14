import type { Commit, GraphEdge, GraphRow } from '@git-octopus/shared';

/** Colour indices cycle within this range; the view resolves them to real colours. */
export const GRAPH_COLOUR_COUNT = 10;

/**
 * A commit that opens a branch still under development: nothing in the graph descends from it (so
 * it was never merged), and a branch — or the working tree — points at it. Tags and stashes do not
 * count: they are dead ends, not lines someone is still committing to.
 */
function isOpenBranchTip(commit: Commit): boolean {
	if (commit.isUncommitted) return true;
	return commit.refs.some((ref) => ref.kind === 'branch' || ref.kind === 'head');
}

/**
 * Pure graph layout engine.
 *
 * Assigns each commit a column and computes the connecting edges to the next row, using a
 * non-compacting "lanes" model. See `03-specs/graph-layout-engine.md` for the full spec.
 *
 * @param listCommits commits in display order (newest first), first parent at `parents[0]`.
 */
export function layoutCommits(listCommits: Commit[]): GraphRow[] {
	const listRows: GraphRow[] = [];
	let lanes: (string | null)[] = []; // hash each column currently expects (a line from above)
	let laneColours: number[] = [];
	let nextColour = 0;
	// How far right any lane has ever reached — the first column no line has ever run through.
	let usedColumns = 0;

	const allocColour = (): number => {
		const colour = nextColour;
		nextColour = (nextColour + 1) % GRAPH_COLOUR_COUNT;
		return colour;
	};

	for (const commit of listCommits) {
		const hash = commit.hash;

		// 1. Node column: the first lane expecting this commit; otherwise a fresh branch-tip lane.
		let nodeColumn = lanes.indexOf(hash);
		const isTip = nodeColumn === -1;
		if (isTip) {
			if (isOpenBranchTip(commit)) {
				// An open branch starts in a column no line has ever run through. A tip has no edge
				// coming into it from above, so dropping it into a column an earlier branch has
				// released would read as that branch simply carrying on.
				nodeColumn = usedColumns;
			} else {
				// Everything else — stashes, tags, dangling tips — takes the next column at the right
				// edge, which is reclaimed once it closes, so the graph stays narrow.
				nodeColumn = lanes.length;
			}
			while (lanes.length <= nodeColumn) {
				lanes.push(null);
				laneColours.push(0);
			}
			laneColours[nodeColumn] = allocColour();
		}
		const nodeColour = laneColours[nodeColumn];

		// 2. Terminating lanes: every column expecting this commit (children converging into it).
		const listTerminating: number[] = [];
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === hash) listTerminating.push(i);
		}

		// 3. Next-row lane state.
		const nextLanes = lanes.slice();
		const nextColours = laneColours.slice();
		for (const i of listTerminating) nextLanes[i] = null;
		if (isTip) nextLanes[nodeColumn] = null;

		const listParentColumns: { column: number; colour: number }[] = [];
		commit.parents.forEach((parent, idx) => {
			const existing = nextLanes.indexOf(parent);
			if (existing !== -1) {
				listParentColumns.push({ column: existing, colour: nextColours[existing] });
				return;
			}
			let column: number;
			let colour: number;
			if (idx === 0) {
				column = nodeColumn;
				colour = nodeColour;
			} else {
				// A merge's extra parents also start their own lane, and they may move into any column
				// an earlier branch has released — the lane hangs off this node's edge, so it reads as
				// a branch of this commit rather than as a continuation of what ran there before.
				column = nextLanes.indexOf(null);
				if (column === -1) {
					column = nextLanes.length;
					nextLanes.push(null);
					nextColours.push(0);
				}
				colour = allocColour();
			}
			nextLanes[column] = parent;
			nextColours[column] = colour;
			listParentColumns.push({ column, colour });
		});

		// 4. Edges from this row down to the next.
		const listEdges: GraphEdge[] = [];
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === null || i === nodeColumn || listTerminating.includes(i)) continue;
			listEdges.push({ fromColumn: i, toColumn: i, colour: laneColours[i] });
		}
		for (const i of listTerminating) {
			if (i === nodeColumn) continue;
			listEdges.push({ fromColumn: i, toColumn: nodeColumn, colour: laneColours[i] });
		}
		for (const parentColumn of listParentColumns) {
			listEdges.push({
				fromColumn: nodeColumn,
				toColumn: parentColumn.column,
				colour: parentColumn.colour,
			});
		}

		listRows.push({ commit, nodeColumn, nodeColour, edges: listEdges });

		if (nextLanes.length > usedColumns) usedColumns = nextLanes.length;

		// Reclaim lanes at the right edge, so the graph does not grow with every branch. Gaps inside
		// the array stay: only a merge's extra parents may move into them.
		while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
			nextLanes.pop();
			nextColours.pop();
		}

		lanes = nextLanes;
		laneColours = nextColours;
	}

	return listRows;
}

/** Number of columns the graph occupies — useful for sizing the view. */
export function graphWidth(listRows: GraphRow[]): number {
	let max = 0;
	for (const row of listRows) {
		if (row.nodeColumn > max) max = row.nodeColumn;
		for (const edge of row.edges) {
			if (edge.fromColumn > max) max = edge.fromColumn;
			if (edge.toColumn > max) max = edge.toColumn;
		}
	}
	return max + 1;
}
