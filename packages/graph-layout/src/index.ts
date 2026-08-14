import type { Commit, GraphLane, GraphRow } from '@git-octopus/shared';

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
 * Assigns each commit a column and reports the lanes crossing each row's top and bottom edge, using
 * a non-compacting "lanes" model — a lane keeps its column until it ends, so a row's output lanes
 * are the next row's input lanes and the view can draw each row on its own.
 * See `03-specs/graph-layout-engine.md` for the full spec.
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

		const listParentColumns: number[] = [];
		commit.parents.forEach((parent, idx) => {
			// A parent already expected somewhere is where this commit's line goes; it does not open a
			// lane of its own, but the line to it still has to be drawn.
			const existing = nextLanes.indexOf(parent);
			if (existing !== -1) {
				listParentColumns.push(existing);
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
			listParentColumns.push(column);
		});

		// 4. The row's own band: what crosses its top edge, and what crosses its bottom edge. The view
		// needs nothing else — no row ever has to ask what the row below it looks like.
		listRows.push({
			commit,
			nodeColumn,
			nodeColour,
			listInputLanes: toLanes(lanes, laneColours),
			listOutputLanes: toLanes(nextLanes, nextColours),
			listParentColumns,
		});

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

function toLanes(listHashes: (string | null)[], listColours: number[]): (GraphLane | null)[] {
	return listHashes.map((hash, i) => (hash === null ? null : { hash, colour: listColours[i] }));
}

/** Number of columns the graph occupies — useful for sizing the view. */
export function graphWidth(listRows: GraphRow[]): number {
	let width = 0;
	for (const row of listRows) {
		width = Math.max(width, row.nodeColumn + 1, lastUsed(row.listInputLanes), lastUsed(row.listOutputLanes));
	}
	return width;
}

function lastUsed(listLanes: (GraphLane | null)[]): number {
	for (let i = listLanes.length - 1; i >= 0; i--) {
		if (listLanes[i] !== null) return i + 1;
	}
	return 0;
}
