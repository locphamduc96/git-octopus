import type { Commit, GraphLane, GraphRow } from '@git-octopus/shared';

/** Colour indices cycle within this range; the view resolves them to real colours. */
export const GRAPH_COLOUR_COUNT = 10;

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
	let laneBranches: number[] = [];
	// Offshoot: the lane was opened for a merge's extra parent, so it hangs off a merge node and is
	// known to die at its fork point. Lanes born at a tip (including the trunk) never become one.
	let laneOffshoots: boolean[] = [];
	// Row where the lane's current expectation was set — the row of its most recent node, so the
	// smaller it is, the longer the straight line currently falling down this lane.
	let laneAwaits: number[] = [];
	let nextColour = 0;
	// Branch-line identities never repeat (colours do), so hover-highlighting can match on them.
	let nextBranch = 0;

	const allocColour = (): number => {
		const colour = nextColour;
		nextColour = (nextColour + 1) % GRAPH_COLOUR_COUNT;
		return colour;
	};

	const allocBranch = (): number => nextBranch++;

	let rowIndex = -1;
	for (const commit of listCommits) {
		rowIndex++;
		const hash = commit.hash;

		// 1. Node column. When several lanes converge on this commit, taking the leftmost would drag
		// a long-lived branch out of its lane at every fork point it shares with a side branch to its
		// left (the checked-out branch under the Uncommitted row being the common case). Instead:
		// prefer a lane that is not an offshoot — offshoots exist only to die at their fork point —
		// and among equals the lane whose line has been falling the longest (smallest await row), so
		// the longest straight line runs on straight and the shorter ones bend into it. At a trunk's
		// fork point that is always the trunk: its last node is a merge of a commit on the side
		// branch, so it sits above the side branch's last node. Ties keep the old leftmost rule.
		let nodeColumn = -1;
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] !== hash) continue;
			if (nodeColumn === -1) {
				nodeColumn = i;
				continue;
			}
			const demoted = laneOffshoots[nodeColumn] && !laneOffshoots[i];
			const longerLine =
				laneOffshoots[nodeColumn] === laneOffshoots[i] && laneAwaits[i] < laneAwaits[nodeColumn];
			if (demoted || longerLine) nodeColumn = i;
		}
		const isTip = nodeColumn === -1;
		if (isTip) {
			// A tip has no edge coming into it from above and gets a fresh colour and branch identity,
			// so it may safely take any free column: a gap a finished branch released, else a new one
			// at the right edge (reclaimed when its lane closes). Reserving an untouched column per
			// tip instead would widen the graph by one column for every stale branch in the repo.
			nodeColumn = lanes.indexOf(null);
			if (nodeColumn === -1) nodeColumn = lanes.length;
			while (lanes.length <= nodeColumn) {
				lanes.push(null);
				laneColours.push(0);
				laneBranches.push(0);
				laneOffshoots.push(false);
				laneAwaits.push(0);
			}
			laneColours[nodeColumn] = allocColour();
			laneBranches[nodeColumn] = allocBranch();
			laneOffshoots[nodeColumn] = false;
			laneAwaits[nodeColumn] = rowIndex;
		}
		const nodeColour = laneColours[nodeColumn];
		const nodeBranch = laneBranches[nodeColumn];

		// 2. Terminating lanes: every column expecting this commit (children converging into it).
		const listTerminating: number[] = [];
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === hash) listTerminating.push(i);
		}

		// 3. Next-row lane state.
		const nextLanes = lanes.slice();
		const nextColours = laneColours.slice();
		const nextBranches = laneBranches.slice();
		const nextOffshoots = laneOffshoots.slice();
		const nextAwaits = laneAwaits.slice();
		for (const i of listTerminating) {
			nextLanes[i] = null;
			// The node's own lane keeps its flag: an offshoot stays an offshoot all the way down its
			// first-parent chain. A lane that closed here must not leak its flag to a later tenant.
			if (i !== nodeColumn) nextOffshoots[i] = false;
		}
		if (isTip) nextLanes[nodeColumn] = null;

		const listParentColumns: number[] = [];
		commit.parents.forEach((parent, idx) => {
			const existing = nextLanes.indexOf(parent);
			// A branch whose first parent is already awaited elsewhere keeps waiting for it in its own
			// column rather than jumping across here. Both lanes then run side by side down to that
			// commit and meet at its node, which is what a branch merging back looks like — stepping
			// across at the branch's last commit instead draws the join in the wrong place entirely.
			if (existing !== -1 && idx > 0) {
				listParentColumns.push(existing);
				return;
			}
			let column: number;
			let colour: number;
			let branch: number;
			if (idx === 0) {
				column = nodeColumn;
				colour = nodeColour;
				branch = nodeBranch;
			} else {
				// A merge's extra parents also start their own lane, and they may move into any column
				// an earlier branch has released — the lane hangs off this node's edge, so it reads as
				// a branch of this commit rather than as a continuation of what ran there before.
				column = nextLanes.indexOf(null);
				if (column === -1) {
					column = nextLanes.length;
					nextLanes.push(null);
					nextColours.push(0);
					nextBranches.push(0);
					nextOffshoots.push(false);
					nextAwaits.push(0);
				}
				colour = allocColour();
				branch = allocBranch();
				// Born hanging off a merge node, so it is the branch that was merged here. An existing
				// lane is never demoted this way: "merged somewhere" also matches the trunk the moment
				// anything merges the trunk in (e.g. `Merge 'master' into dev`), and a trunk demoted
				// once would lose every convergence below.
				nextOffshoots[column] = true;
			}
			nextLanes[column] = parent;
			nextColours[column] = colour;
			nextBranches[column] = branch;
			nextAwaits[column] = rowIndex;
			listParentColumns.push(column);
		});

		// 4. The row's own band: what crosses its top edge, and what crosses its bottom edge. The view
		// needs nothing else — no row ever has to ask what the row below it looks like.
		listRows.push({
			commit,
			nodeColumn,
			nodeColour,
			nodeBranch,
			listInputLanes: toLanes(lanes, laneColours, laneBranches),
			listOutputLanes: toLanes(nextLanes, nextColours, nextBranches),
			listParentColumns,
		});

		// Reclaim lanes at the right edge, so the graph does not grow with every branch. Gaps inside
		// the array stay, available to the next tip or merge parent looking for a column.
		while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
			nextLanes.pop();
			nextColours.pop();
			nextBranches.pop();
			nextOffshoots.pop();
			nextAwaits.pop();
		}

		lanes = nextLanes;
		laneColours = nextColours;
		laneBranches = nextBranches;
		laneOffshoots = nextOffshoots;
		laneAwaits = nextAwaits;
	}

	return listRows;
}

function toLanes(
	listHashes: (string | null)[],
	listColours: number[],
	listBranches: number[]
): (GraphLane | null)[] {
	return listHashes.map((hash, i) =>
		hash === null ? null : { hash, colour: listColours[i], branch: listBranches[i] }
	);
}

/** Number of columns the graph occupies — useful for sizing the view. */
export function graphWidth(listRows: GraphRow[]): number {
	let width = 0;
	for (const row of listRows) {
		width = Math.max(
			width,
			row.nodeColumn + 1,
			lastUsed(row.listInputLanes),
			lastUsed(row.listOutputLanes)
		);
	}
	return width;
}

function lastUsed(listLanes: (GraphLane | null)[]): number {
	for (let i = listLanes.length - 1; i >= 0; i--) {
		if (listLanes[i] !== null) return i + 1;
	}
	return 0;
}
