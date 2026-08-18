import { describe, expect, it } from 'vitest';
import { planReveal } from './revealPlan';

describe('planReveal', () => {
	it('reveals a row that is already loaded', () => {
		expect(planReveal({ loaded: true, hasMore: true, pagesLeft: 3 })).toEqual({ kind: 'reveal' });
	});

	it('loads more history for a commit below the loaded page', () => {
		// The detached-HEAD banner names a commit the walk has not reached yet.
		expect(planReveal({ loaded: false, hasMore: true, pagesLeft: 3 })).toEqual({
			kind: 'loadMore',
		});
	});

	it('gives up once there is no more history to load', () => {
		expect(planReveal({ loaded: false, hasMore: false, pagesLeft: 3 })).toEqual({
			kind: 'giveUp',
		});
	});

	it('gives up rather than paging forever', () => {
		// Without this the button would keep loading and never say it failed.
		expect(planReveal({ loaded: false, hasMore: true, pagesLeft: 0 })).toEqual({ kind: 'giveUp' });
	});

	it('reveals even when the budget is spent, once the row has arrived', () => {
		expect(planReveal({ loaded: true, hasMore: true, pagesLeft: 0 })).toEqual({ kind: 'reveal' });
	});
});
