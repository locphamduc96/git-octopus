import { describe, expect, it } from 'vitest';
import { rowWindow, shouldAskLoadMore, type LoadMoreState } from './virtualWindow';

const ROW_H = 34;
const OVERSCAN = 8;

describe('rowWindow', () => {
	it('starts at the top without negative overscan', () => {
		expect(rowWindow(0, 600, ROW_H, 1000, OVERSCAN)).toEqual({
			start: 0,
			end: Math.ceil(600 / ROW_H) + OVERSCAN,
		});
	});

	it('slices around the scroll position with overscan on both sides', () => {
		const scrollTop = 340; // exactly 10 rows down
		expect(rowWindow(scrollTop, 600, ROW_H, 1000, OVERSCAN)).toEqual({
			start: 10 - OVERSCAN,
			end: Math.ceil((scrollTop + 600) / ROW_H) + OVERSCAN,
		});
	});

	it('clamps the end to the list', () => {
		const { start, end } = rowWindow(33500, 600, ROW_H, 1000, OVERSCAN);
		expect(end).toBe(1000);
		expect(start).toBeLessThan(end);
	});

	it('covers a list shorter than the viewport whole', () => {
		expect(rowWindow(0, 600, ROW_H, 5, OVERSCAN)).toEqual({ start: 0, end: 5 });
	});
});

describe('shouldAskLoadMore', () => {
	const nearBottom: LoadMoreState = {
		scrollTop: 34000 - 600 - ROW_H * 5,
		viewportH: 600,
		totalH: 34000,
		rowH: ROW_H,
		rowCount: 1000,
		askedAt: 0,
		hasMore: true,
	};

	it('asks exactly from five rows above the bottom', () => {
		expect(shouldAskLoadMore(nearBottom)).toBe(true);
		expect(shouldAskLoadMore({ ...nearBottom, scrollTop: nearBottom.scrollTop - 1 })).toBe(false);
	});

	it('asks only once per row count', () => {
		expect(shouldAskLoadMore({ ...nearBottom, askedAt: 1000 })).toBe(false);
		// A new page arrived (row count moved on), so the same position may ask again.
		expect(shouldAskLoadMore({ ...nearBottom, askedAt: 700 })).toBe(true);
	});

	it('never asks when history is exhausted', () => {
		expect(shouldAskLoadMore({ ...nearBottom, hasMore: false })).toBe(false);
	});
});
