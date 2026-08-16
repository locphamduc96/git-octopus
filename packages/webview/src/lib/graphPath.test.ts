import { describe, expect, it } from 'vitest';
import {
	branchOut,
	intoNode,
	laneX,
	mergeIn,
	outOfNode,
	passThrough,
	type LaneMetrics,
} from './graphPath';

const M: LaneMetrics = {
	columnWidth: 20,
	rowHeight: 34,
	padding: 12,
	curve: 8,
	style: 'rounded',
};

/** Every y coordinate a path mentions, in order. */
function ys(path: string): number[] {
	return [...path.matchAll(/-?[\d.]+\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
}

describe('lane paths', () => {
	it('runs a pass-through lane edge to edge', () => {
		// Reaching both edges is what makes one row line up with the next.
		expect(passThrough(1, M)).toBe('M32 0 L32 34');
	});

	it("splits the node's own lane at the node", () => {
		expect(intoNode(0, M)).toBe('M12 0 L12 17');
		expect(outOfNode(0, M)).toBe('M12 17 L12 34');
	});

	it('bends a merging lane in the upper half and a branching lane in the lower half', () => {
		// The two are mirror images, so a branch reads the same whichever way it runs.
		expect(ys(mergeIn(1, 0, M)).every((y) => y <= 17)).toBe(true);
		expect(ys(branchOut(0, 1, M)).every((y) => y >= 17)).toBe(true);
	});

	it('runs a merging lane down its own column before turning', () => {
		// Turning early would bulge the curve upwards and pull the lane off its column.
		expect(mergeIn(1, 0, M).startsWith('M32 0 L32 9')).toBe(true);
	});

	it('turns a branching lane only once it has reached the column it is joining', () => {
		expect(branchOut(0, 1, M).endsWith('Q32 17 32 25 L32 34')).toBe(true);
	});

	it('bends left and right alike', () => {
		expect(branchOut(2, 1, M)).toBe('M52 17 L40 17 Q32 17 32 25 L32 34');
		expect(mergeIn(1, 2, M)).toBe('M32 0 L32 9 Q32 17 40 17 L52 17');
	});

	it('never bends further than the gap it is crossing', () => {
		// Lanes closer together than the corner radius: the bend shrinks to the gap and the straight
		// run between the node and the corner collapses to nothing, rather than the curve overshooting
		// the column it is aiming at.
		const tight: LaneMetrics = { ...M, columnWidth: 6, curve: 8 };
		expect(branchOut(0, 1, tight)).toBe('M12 17 L12 17 Q18 17 18 23 L18 34');
	});

	it('keeps the angular style square', () => {
		const angular: LaneMetrics = { ...M, style: 'angular' };
		expect(mergeIn(1, 0, angular)).toBe('M32 0 L32 17 L12 17');
		expect(branchOut(0, 1, angular)).toBe('M12 17 L32 17 L32 34');
	});

	it('cuts the diagonal style across at 45° when the row is tall enough', () => {
		// Half a spacious row (22) is taller than one column gap (20), so the whole crossing fits in
		// the diagonal: it drops exactly as far as it travels sideways, with no level run left over.
		const roomy: LaneMetrics = { ...M, rowHeight: 44, style: 'diagonal' };
		expect(mergeIn(1, 0, roomy)).toBe('M32 0 L32 2 L12 22');
		expect(branchOut(0, 1, roomy)).toBe('M12 22 L32 42 L32 44');
	});

	it('runs a long crossing level and keeps the diagonal at 45°', () => {
		// Five columns (100px) across half a spacious row (22): the diagonal takes the last 22px and
		// the other 78 are level, so a lane reaching far sideways still bends at the same angle as a
		// neighbouring one that only steps over by a column.
		const roomy: LaneMetrics = { ...M, rowHeight: 44, style: 'diagonal' };
		expect(mergeIn(5, 0, roomy)).toBe('M112 0 L112 0 L90 22 L12 22');
		expect(branchOut(0, 5, roomy)).toBe('M12 22 L90 22 L112 44 L112 44');
	});

	it('keeps the diagonal inside its own row', () => {
		// A comfortable row leaves 17px for a 20px gap. Every path belongs to one row and nothing may
		// be drawn outside it, so the diagonal is capped at the half-row and the remaining 3px go into
		// the level run — the path still meets both edges square.
		const diagonal: LaneMetrics = { ...M, style: 'diagonal' };
		expect(mergeIn(1, 0, diagonal)).toBe('M32 0 L32 0 L15 17 L12 17');
		expect(ys(mergeIn(1, 0, diagonal)).every((y) => y <= 17)).toBe(true);
		expect(ys(branchOut(0, 1, diagonal)).every((y) => y >= 17)).toBe(true);
	});

	it('places lanes on a fixed pitch', () => {
		expect(laneX(0, M)).toBe(12);
		expect(laneX(2, M)).toBe(52);
	});
});
