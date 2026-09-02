import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_FETCH_MINUTES, pickAutoFetchMinutes } from '@git-octopus/shared';
import { MAX_CONSECUTIVE_FAILURES, planAutoFetch, type AutoFetchState } from './autoFetch.js';

const READY: AutoFetchState = {
	intervalMinutes: 5,
	sinceLastMs: 10 * 60_000,
	busy: false,
	focused: true,
	sequencerActive: false,
	failures: 0,
};

describe('planAutoFetch', () => {
	it('fetches when everything is clear and the interval has passed', () => {
		expect(planAutoFetch(READY)).toEqual({ run: true });
	});

	it('fetches on the first tick, before anything has run', () => {
		expect(planAutoFetch({ ...READY, sinceLastMs: null })).toEqual({ run: true });
	});

	it('never fetches while the setting is off', () => {
		expect(planAutoFetch({ ...READY, intervalMinutes: 0 })).toEqual({
			run: false,
			reason: 'disabled',
		});
	});

	it('treats a negative interval as off rather than as always', () => {
		expect(planAutoFetch({ ...READY, intervalMinutes: -1 })).toEqual({
			run: false,
			reason: 'disabled',
		});
	});

	it('stops for the session once failures reach the limit', () => {
		expect(planAutoFetch({ ...READY, failures: MAX_CONSECUTIVE_FAILURES })).toEqual({
			run: false,
			reason: 'backedOff',
		});
	});

	it('still fetches one failure short of the limit', () => {
		expect(planAutoFetch({ ...READY, failures: MAX_CONSECUTIVE_FAILURES - 1 })).toEqual({
			run: true,
		});
	});

	it('does not start a second fetch over a running one', () => {
		expect(planAutoFetch({ ...READY, busy: true })).toEqual({ run: false, reason: 'busy' });
	});

	it('leaves the refs alone while a rebase or merge is open', () => {
		expect(planAutoFetch({ ...READY, sequencerActive: true })).toEqual({
			run: false,
			reason: 'sequencer',
		});
	});

	it('spends no network on a window nobody is looking at', () => {
		expect(planAutoFetch({ ...READY, focused: false })).toEqual({
			run: false,
			reason: 'unfocused',
		});
	});

	it('waits until the interval has actually passed', () => {
		expect(planAutoFetch({ ...READY, sinceLastMs: 60_000 })).toEqual({
			run: false,
			reason: 'tooSoon',
		});
	});

	it('fetches exactly on the boundary', () => {
		expect(planAutoFetch({ ...READY, sinceLastMs: 5 * 60_000 })).toEqual({ run: true });
	});

	// The reported reason is the one worth saying, not whichever check happened to run first.
	it('calls a disabled schedule disabled, whatever else is also true', () => {
		expect(
			planAutoFetch({
				...READY,
				intervalMinutes: 0,
				busy: true,
				focused: false,
				sequencerActive: true,
				failures: 99,
			})
		).toEqual({ run: false, reason: 'disabled' });
	});

	it('reports backing off ahead of a transient block', () => {
		expect(planAutoFetch({ ...READY, failures: 5, focused: false })).toEqual({
			run: false,
			reason: 'backedOff',
		});
	});
});

describe('pickAutoFetchMinutes', () => {
	it('keeps an offered interval', () => {
		expect(pickAutoFetchMinutes(15)).toBe(15);
	});

	// Never is a choice; a missing value is the absence of one. They must not read the same.
	it('keeps never when the user actually chose it', () => {
		expect(pickAutoFetchMinutes(0)).toBe(0);
	});

	it('falls back to the default when nothing has been stored yet', () => {
		expect(pickAutoFetchMinutes(undefined)).toBe(DEFAULT_AUTO_FETCH_MINUTES);
	});

	it('falls back to the default for an interval that is not offered', () => {
		expect(pickAutoFetchMinutes(7)).toBe(DEFAULT_AUTO_FETCH_MINUTES);
	});

	it('falls back to the default for anything that is not a number', () => {
		expect(pickAutoFetchMinutes('5')).toBe(DEFAULT_AUTO_FETCH_MINUTES);
		expect(pickAutoFetchMinutes(null)).toBe(DEFAULT_AUTO_FETCH_MINUTES);
	});

	it('offers an interval that is actually usable as the default', () => {
		expect(pickAutoFetchMinutes(DEFAULT_AUTO_FETCH_MINUTES)).toBe(DEFAULT_AUTO_FETCH_MINUTES);
		expect(DEFAULT_AUTO_FETCH_MINUTES).toBeGreaterThan(0);
	});
});
