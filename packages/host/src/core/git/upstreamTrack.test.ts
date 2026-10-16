import { hasGap, isLevel } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import { parseUpstreamTracking } from './upstreamTrack.js';

describe('parseUpstreamTracking', () => {
	// The six shapes `git for-each-ref` actually produces, measured on git 2.50.1.
	it('answers null for a branch with no upstream', () => {
		expect(parseUpstreamTracking('', '', '')).toBeNull();
	});

	it('answers a level record for a branch in sync', () => {
		expect(parseUpstreamTracking('origin/main', '', '=')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: 0,
			gone: false,
		});
	});

	it('reads a branch that is only behind', () => {
		expect(parseUpstreamTracking('origin/main', '[behind 2]', '<')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: 2,
			gone: false,
		});
	});

	it('reads a branch that is only ahead', () => {
		expect(parseUpstreamTracking('origin/main', '[ahead 1]', '>')).toEqual({
			upstream: 'origin/main',
			ahead: 1,
			behind: 0,
			gone: false,
		});
	});

	it('reads a diverged branch', () => {
		expect(parseUpstreamTracking('origin/main', '[ahead 1, behind 2]', '<>')).toEqual({
			upstream: 'origin/main',
			ahead: 1,
			behind: 2,
			gone: false,
		});
	});

	it('flags an upstream whose remote ref is gone', () => {
		expect(parseUpstreamTracking('origin/x', '[gone]', '')).toEqual({
			upstream: 'origin/x',
			ahead: 0,
			behind: 0,
			gone: true,
		});
	});

	// A translated git is the reason `trackshort` is read at all.
	it('keeps the direction and drops the numbers when the words do not parse', () => {
		expect(parseUpstreamTracking('origin/main', '[derrière 2]', '<')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: null,
			gone: false,
		});
	});

	it('keeps both directions when a diverged branch does not parse', () => {
		expect(parseUpstreamTracking('origin/main', '[devant 1, derrière 2]', '<>')).toEqual({
			upstream: 'origin/main',
			ahead: null,
			behind: null,
			gone: false,
		});
	});

	// Never "in sync": that is the one reading a user would act on.
	it('never reports level when trackshort says there is a gap', () => {
		const parsed = parseUpstreamTracking('origin/main', 'unreadable', '<');
		expect(parsed).not.toBeNull();
		expect(isLevel(parsed!)).toBe(false);
	});

	it('trusts the counts when trackshort says nothing', () => {
		expect(parseUpstreamTracking('origin/main', '[behind 2]', '')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: 2,
			gone: false,
		});
	});

	it('ignores a count that is not a usable number', () => {
		expect(parseUpstreamTracking('origin/main', '[behind 99999999999999999999]', '')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: 0,
			gone: false,
		});
	});

	it('trims surrounding whitespace on every field', () => {
		expect(parseUpstreamTracking('  origin/main  ', ' [behind 2] ', ' < ')).toEqual({
			upstream: 'origin/main',
			ahead: 0,
			behind: 2,
			gone: false,
		});
	});

	it('treats a whitespace-only upstream as no upstream', () => {
		expect(parseUpstreamTracking('   ', '', '')).toBeNull();
	});
});

describe('hasGap', () => {
	it('counts an unreadable number as a gap', () => {
		expect(hasGap(null)).toBe(true);
	});

	it('counts zero as no gap', () => {
		expect(hasGap(0)).toBe(false);
	});

	it('counts a positive number as a gap', () => {
		expect(hasGap(3)).toBe(true);
	});
});

describe('isLevel', () => {
	const base = { upstream: 'origin/main', ahead: 0, behind: 0, gone: false };

	it('is true only when both counts are zero and the upstream is there', () => {
		expect(isLevel(base)).toBe(true);
	});

	it('is false while the branch is ahead', () => {
		expect(isLevel({ ...base, ahead: 1 })).toBe(false);
	});

	it('is false while the branch is behind', () => {
		expect(isLevel({ ...base, behind: 1 })).toBe(false);
	});

	it('is false while the upstream is gone', () => {
		expect(isLevel({ ...base, gone: true })).toBe(false);
	});
});
