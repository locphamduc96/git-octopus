import { describe, expect, it } from 'vitest';
import { stepAcrossLanes, stepAlongLane } from './keyNav';

describe('stepAlongLane', () => {
	// Rows are ordered by date, so the row below a node usually belongs to another lane.
	const listBranches = [1, 2, 1, 2, 3];

	it('skips past rows on other lanes going down', () => {
		expect(stepAlongLane(listBranches, 0, 1)).toBe(2);
	});

	it('skips past rows on other lanes going up', () => {
		expect(stepAlongLane(listBranches, 3, -1)).toBe(1);
	});

	// Staying put beats jumping to an unrelated commit: a key that sometimes lands somewhere else
	// is a key nobody presses twice.
	it('stays put at the end of a lane', () => {
		expect(stepAlongLane(listBranches, 2, 1)).toBe(2);
	});

	it('stays put at the start of a lane', () => {
		expect(stepAlongLane(listBranches, 0, -1)).toBe(0);
	});

	it('stays put on a lane with only one row', () => {
		expect(stepAlongLane(listBranches, 4, 1)).toBe(4);
		expect(stepAlongLane(listBranches, 4, -1)).toBe(4);
	});

	it('answers the index it was given when nothing is selected', () => {
		expect(stepAlongLane(listBranches, -1, 1)).toBe(-1);
	});

	it('answers the index it was given when it is out of range', () => {
		expect(stepAlongLane(listBranches, 99, 1)).toBe(99);
	});
});

describe('stepAcrossLanes', () => {
	const listColumns = [0, 1, 2, 0, 1];

	it('moves to the nearest row one column to the right', () => {
		expect(stepAcrossLanes(listColumns, 0, 1)).toBe(1);
	});

	it('moves to the nearest row one column to the left', () => {
		expect(stepAcrossLanes(listColumns, 2, -1)).toBe(1);
	});

	// The adjacent column wins before distance does: skipping a lane because one of its commits is
	// closer reads as a jump rather than a step.
	it('prefers the adjacent column over a nearer row further out', () => {
		expect(stepAcrossLanes([0, 3, 1], 0, 1)).toBe(2);
	});

	it('picks the nearest row when several sit on the same column', () => {
		expect(stepAcrossLanes([1, 0, 0], 0, -1)).toBe(1);
	});

	it('stays put at the leftmost column', () => {
		expect(stepAcrossLanes(listColumns, 0, -1)).toBe(0);
	});

	it('stays put at the rightmost column', () => {
		expect(stepAcrossLanes(listColumns, 2, 1)).toBe(2);
	});

	it('answers the index it was given when nothing is selected', () => {
		expect(stepAcrossLanes(listColumns, -1, 1)).toBe(-1);
	});
});
