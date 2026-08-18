import type { GraphRow } from '@git-octopus/shared';
import {
	branchOut,
	intoNode,
	mergeIn,
	outOfNode,
	passThrough,
	type LaneMetrics,
} from './graphPath';

export interface LaneSegment {
	d: string;
	colour: number;
	/** Branch-line identity, for hover highlighting. */
	branch: number;
	/** Leaves this row's node, so a stash can draw its line dashed. */
	fromNode: boolean;
}

/**
 * Every line to draw in one row's band, from its lanes alone.
 *
 * A lane keeps its column for its whole life, so a column changes hands only at a node: either a
 * lane arrives here and is consumed, or one starts here for a parent. That leaves four shapes and
 * no cross-row questions.
 */
export function laneSegments(row: GraphRow, metrics: LaneMetrics): LaneSegment[] {
	const listSegments: LaneSegment[] = [];
	const node = row.nodeColumn;
	const hash = row.commit.hash;
	for (let column = 0; column < row.listInputLanes.length; column++) {
		const input = row.listInputLanes[column] ?? null;

		if (input && input.hash !== hash) {
			// Not this commit's lane, so it crosses the whole band untouched.
			listSegments.push({
				d: passThrough(column, metrics),
				colour: input.colour,
				branch: input.branch,
				fromNode: false,
			});
			continue;
		}
		if (input) {
			listSegments.push(
				column === node
					? {
							d: intoNode(column, metrics),
							colour: input.colour,
							branch: input.branch,
							fromNode: false,
						}
					: {
							d: mergeIn(column, node, metrics),
							colour: input.colour,
							branch: input.branch,
							fromNode: false,
						}
			);
		}
	}

	// The lines out of the node, one per parent. Driven by the parent columns rather than by the
	// output lanes: a parent another lane already awaits opens no lane of its own, so the lanes
	// alone would leave this commit with no way down.
	for (const column of row.listParentColumns) {
		const lane = row.listOutputLanes[column];
		const colour = lane?.colour ?? row.nodeColour;
		const branch = lane?.branch ?? row.nodeBranch;
		listSegments.push(
			column === node
				? { d: outOfNode(column, metrics), colour, branch, fromNode: true }
				: { d: branchOut(node, column, metrics), colour, branch, fromNode: true }
		);
	}
	return listSegments;
}
