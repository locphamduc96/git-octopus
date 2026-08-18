import { describe, expect, it } from 'vitest';
import { parseAheadBehind, planCheckout, type CheckoutState } from './checkoutPlan.js';

const BASE: CheckoutState = {
	localExists: true,
	ahead: 0,
	behind: 0,
	dirty: false,
	autoFastForward: true,
};

describe('planCheckout', () => {
	it('creates a tracking branch when there is no local branch yet', () => {
		expect(planCheckout({ ...BASE, localExists: false })).toEqual({ kind: 'createTracking' });
	});

	it('just checks out a local branch that is already up to date', () => {
		expect(planCheckout(BASE)).toEqual({ kind: 'checkoutOnly' });
	});

	it('fast-forwards a local branch that has only fallen behind', () => {
		// The case that used to fail with "branch already exists": pulled once, then left alone.
		expect(planCheckout({ ...BASE, behind: 3 })).toEqual({ kind: 'checkoutFastForward', count: 3 });
	});

	it('leaves a diverged branch alone and says so', () => {
		// `--ff-only` would refuse this; saying it plainly beats relaying git's error.
		const plan = planCheckout({ ...BASE, ahead: 2, behind: 3 });
		expect(plan.kind).toBe('checkoutOnly');
		expect(plan).toHaveProperty('note', '3 commits behind and 2 ahead — branches diverged');
	});

	it('does not touch the working tree while it is dirty', () => {
		const plan = planCheckout({ ...BASE, behind: 1, dirty: true });
		expect(plan.kind).toBe('checkoutOnly');
		expect(plan).toHaveProperty('note', '1 commit behind; uncommitted changes left it alone');
	});

	it('only reports the gap once the setting is off', () => {
		const plan = planCheckout({ ...BASE, behind: 4, autoFastForward: false });
		expect(plan).toEqual({ kind: 'checkoutOnly', note: '4 commits behind' });
	});
});

describe('parseAheadBehind', () => {
	it('reads the left/right counts git prints', () => {
		expect(parseAheadBehind('2\t3\n')).toEqual({ ahead: 2, behind: 3 });
	});

	it('reads nothing as no gap either way', () => {
		// An unmerged or missing ref prints nothing; treating that as "behind" would fast-forward blind.
		expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 });
	});
});
