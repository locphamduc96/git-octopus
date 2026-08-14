import { describe, expect, it } from 'vitest';
import { edgePath, type EdgeGeometry } from './graphPath';

const BASE: EdgeGeometry = {
	x1: 32,
	x2: 32,
	yTop: 17,
	yBottom: 51,
	fromRadius: 0,
	toRadius: 0,
	style: 'rounded',
};

/** Every y a path mentions, in order. */
function ys(path: string): number[] {
	return [...path.matchAll(/-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

describe('edgePath', () => {
	it('runs straight down a lane that keeps its column', () => {
		expect(edgePath(BASE)).toBe('M32 17 L32 51');
	});

	it('stops short of a node at either end, so nothing is drawn inside one', () => {
		expect(edgePath({ ...BASE, fromRadius: 5, toRadius: 9 })).toBe('M32 22 L32 42');
	});

	it('turns at the bottom and arrives in the side of the node it lands on', () => {
		const path = edgePath({ ...BASE, x2: 12, fromRadius: 5, toRadius: 5 });
		// Vertical in the starting column first — the bulge is underneath, not above.
		expect(path.startsWith('M32 22 L32 ')).toBe(true);
		// One quarter bend, ending on the node's right-hand edge rather than its centre.
		expect(path.endsWith('Q32 51 17 51')).toBe(true);
	});

	it('leaves the node at its edge, never from its centre', () => {
		const path = edgePath({ ...BASE, x2: 12, fromRadius: 5, toRadius: 5 });
		expect(path.startsWith('M32 22')).toBe(true);
	});

	it('keeps both ends vertical when the lane carries on below', () => {
		// Nothing to land on, so a quarter bend would leave the lane below hanging off a corner.
		const path = edgePath({ ...BASE, x2: 12, fromRadius: 5 });
		expect(path).toBe('M32 22 C32 36.5 12 36.5 12 51');
	});

	it('weights that curve to the bottom, so it still bulges downwards', () => {
		const path = edgePath({ ...BASE, x2: 12, fromRadius: 5 });
		const listY = ys(path);
		const middle = (BASE.yTop + BASE.yBottom) / 2;
		// Both control points sit below the halfway line: the line stays in its own column for the
		// first stretch and only swings across near the bottom.
		expect(listY[1]).toBeGreaterThan(middle);
		expect(listY[2]).toBeGreaterThan(middle);
	});

	it('never turns further than the segment is long', () => {
		// A jump of several columns in one row would otherwise curve past the row below it.
		const path = edgePath({ ...BASE, x2: 132, fromRadius: 5, toRadius: 5 });
		expect(ys(path).every((y) => y >= 17 && y <= 51)).toBe(true);
	});

	it('keeps the angular style square', () => {
		expect(edgePath({ ...BASE, x2: 12, style: 'angular' })).toBe('M32 17 L32 34 L12 34 L12 51');
	});
});
