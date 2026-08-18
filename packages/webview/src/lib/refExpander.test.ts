import { describe, expect, it } from 'vitest';
import { clampExpandRight, expanderAnchor, shouldExpand } from './refExpander';
import type { RefChip } from './graphChips';

function chip(name: string): RefChip {
	return { kind: 'branch', name, checkedOut: false, hasLocal: true, listRemotes: [], title: '' };
}

describe('shouldExpand', () => {
	it('stays shut for a row whose chips all fit', () => {
		expect(
			shouldExpand({ listChips: [chip('main')], hasOverflow: false, isTruncated: false })
		).toBe(false);
	});

	it('opens when a name is cut down to an ellipsis', () => {
		expect(shouldExpand({ listChips: [chip('main')], hasOverflow: false, isTruncated: true })).toBe(
			true
		);
	});

	it('opens when chips are folded behind the badge, even if nothing visible is cut', () => {
		expect(shouldExpand({ listChips: [chip('main')], hasOverflow: true, isTruncated: false })).toBe(
			true
		);
	});

	it('stays shut for a row with no refs at all', () => {
		expect(shouldExpand({ listChips: [], hasOverflow: true, isTruncated: true })).toBe(false);
	});
});

describe('expanderAnchor', () => {
	it('lines the panel up so its first chip lands on the chip it replaces', () => {
		// A chip whose right edge is 60px from a 1000px viewport, inside a panel padded by 4.
		expect(expanderAnchor({ top: 120, right: 940 }, 4, 1000)).toEqual({ right: 56, y: 116 });
	});
});

describe('clampExpandRight', () => {
	it('leaves an anchor alone when the panel already fits', () => {
		expect(clampExpandRight(600, 300, 1000, 8)).toBe(600);
	});

	it('slides the panel right when its far end would leave the viewport', () => {
		// Anchored 600 from the right of a 1000 viewport, a 500-wide panel would start at -100.
		expect(clampExpandRight(600, 500, 1000, 8)).toBe(492);
	});

	it('keeps a panel wider than the viewport pinned to the near edge instead of past it', () => {
		expect(clampExpandRight(600, 1200, 1000, 8)).toBe(8);
	});

	it('waits for a real measurement before correcting anything', () => {
		expect(clampExpandRight(600, 0, 1000, 8)).toBe(600);
	});
});
