import { describe, expect, it } from 'vitest';
import type { Commit, GraphLane, GraphRow } from '@git-octopus/shared';
import {
	branchOut,
	intoNode,
	mergeIn,
	outOfNode,
	passThrough,
	type LaneMetrics,
} from './graphPath';
import { laneSegments } from './graphSegments';

const metrics: LaneMetrics = {
	columnWidth: 20,
	rowHeight: 34,
	padding: 12,
	curve: 8,
	style: 'rounded',
};

function commit(hash: string): Commit {
	return {
		hash,
		parents: [],
		author: { name: 'a', email: 'a@x' },
		committedAt: 0,
		authoredAt: 0,
		subject: '',
		refs: [],
	};
}

function lane(hash: string, colour: number, branch: number): GraphLane {
	return { hash, colour, branch };
}

function row(partial: Partial<GraphRow>): GraphRow {
	return {
		commit: commit('self'),
		nodeColumn: 0,
		nodeColour: 1,
		nodeBranch: 10,
		listInputLanes: [],
		listOutputLanes: [],
		listParentColumns: [],
		...partial,
	};
}

describe('laneSegments', () => {
	it('draws a lane waiting for another commit straight through the band', () => {
		const listSegments = laneSegments(
			row({ listInputLanes: [null, lane('other', 3, 30)] }),
			metrics
		);
		expect(listSegments).toEqual([
			{ d: passThrough(1, metrics), colour: 3, branch: 30, fromNode: false },
		]);
	});

	it("draws this commit's own lane into the node, and a lane from elsewhere as a merge", () => {
		const listSegments = laneSegments(
			row({
				nodeColumn: 0,
				listInputLanes: [lane('self', 1, 10), lane('self', 2, 20)],
			}),
			metrics
		);
		expect(listSegments).toEqual([
			{ d: intoNode(0, metrics), colour: 1, branch: 10, fromNode: false },
			{ d: mergeIn(1, 0, metrics), colour: 2, branch: 20, fromNode: false },
		]);
	});

	it('leaves the node straight down in its own column, and bends out to another', () => {
		const listSegments = laneSegments(
			row({
				nodeColumn: 0,
				listParentColumns: [0, 2],
				listOutputLanes: [lane('p1', 1, 10), null, lane('p2', 4, 40)],
			}),
			metrics
		);
		expect(listSegments).toEqual([
			{ d: outOfNode(0, metrics), colour: 1, branch: 10, fromNode: true },
			{ d: branchOut(0, 2, metrics), colour: 4, branch: 40, fromNode: true },
		]);
	});

	it('colours a parent already awaited by another lane with that lane, not the node', () => {
		// The parent lives in column 1 where an existing lane waits for it; the segment must take
		// that lane's colour and branch so the line reads as joining it.
		const listSegments = laneSegments(
			row({
				nodeColumn: 0,
				nodeColour: 1,
				nodeBranch: 10,
				listParentColumns: [1],
				listOutputLanes: [null, lane('parent', 7, 70)],
			}),
			metrics
		);
		expect(listSegments).toEqual([
			{ d: branchOut(0, 1, metrics), colour: 7, branch: 70, fromNode: true },
		]);
	});

	it("falls back to the node's colour when no output lane owns the parent column", () => {
		const listSegments = laneSegments(
			row({ nodeColumn: 0, nodeColour: 5, nodeBranch: 50, listParentColumns: [0] }),
			metrics
		);
		expect(listSegments).toEqual([
			{ d: outOfNode(0, metrics), colour: 5, branch: 50, fromNode: true },
		]);
	});

	it('marks only the lines leaving the node, so a stash can dash them', () => {
		const listSegments = laneSegments(
			row({
				nodeColumn: 0,
				listInputLanes: [lane('self', 1, 10), lane('other', 2, 20)],
				listParentColumns: [0],
				listOutputLanes: [lane('parent', 1, 10)],
			}),
			metrics
		);
		expect(listSegments.map((segment) => segment.fromNode)).toEqual([false, false, true]);
	});
});
