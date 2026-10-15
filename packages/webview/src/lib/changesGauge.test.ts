import { describe, expect, it } from 'vitest';
import { changesGauge, changesTooltip } from './changesGauge';

const stat = (insertions: number, deletions: number, files = 1) => ({
	hash: 'a'.repeat(40),
	files,
	insertions,
	deletions,
});

describe('changesGauge', () => {
	it('draws nothing for a commit that changed no lines', () => {
		expect(changesGauge(stat(0, 0, 0))).toEqual({ widthPct: 0, addedPct: 0 });
	});

	it('grows on a log scale, keeps small commits visible and caps huge ones', () => {
		const one = changesGauge(stat(1, 0)).widthPct;
		const hundred = changesGauge(stat(60, 40)).widthPct;
		const huge = changesGauge(stat(50_000, 0)).widthPct;
		expect(one).toBeGreaterThanOrEqual(8);
		expect(hundred).toBeGreaterThan(one);
		expect(hundred).toBeCloseTo(50, 0);
		expect(huge).toBe(100);
	});

	it('splits the bar by what was added', () => {
		expect(changesGauge(stat(30, 10)).addedPct).toBe(75);
	});
});

describe('changesTooltip', () => {
	it('spells the counts out, singular or plural', () => {
		expect(changesTooltip(stat(1, 2, 1))).toBe('1 file changed, 1 insertion, 2 deletions');
	});
});
