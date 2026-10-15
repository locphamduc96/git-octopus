import { describe, expect, it } from 'vitest';
import { buildDiffKey, isCacheableDiffKey, rightRevision } from './diffKey';

describe('buildDiffKey', () => {
	it('encodes every part that changes what the diff shows', () => {
		expect(buildDiffKey({ path: 'src/a.ts', hash: 'abc' }, 3)).toBe('abc||||3|src/a.ts');
		expect(buildDiffKey({ path: 'src/a.ts', fromHash: 'abc', toHash: 'def' }, 3)).toBe(
			'|abc|def||3|src/a.ts'
		);
		expect(buildDiffKey({ path: 'src/a.ts', untracked: true }, 3)).toBe('|||u|3|src/a.ts');
		expect(buildDiffKey({ path: 'src/a.ts' }, 3)).toBe('||||3|src/a.ts');
	});

	it('differs when context or path change', () => {
		const key = buildDiffKey({ path: 'src/a.ts', hash: 'abc' }, 3);
		expect(buildDiffKey({ path: 'src/a.ts', hash: 'abc' }, 1_000_000)).not.toBe(key);
		expect(buildDiffKey({ path: 'src/b.ts', hash: 'abc' }, 3)).not.toBe(key);
	});
});

describe('isCacheableDiffKey', () => {
	it('caches only diffs pinned to revisions', () => {
		expect(isCacheableDiffKey(buildDiffKey({ path: 'a', hash: 'abc' }, 3))).toBe(true);
		expect(isCacheableDiffKey(buildDiffKey({ path: 'a', fromHash: 'x', toHash: 'y' }, 3))).toBe(
			true
		);
	});

	it('never caches working-tree or untracked diffs', () => {
		expect(isCacheableDiffKey(buildDiffKey({ path: 'a' }, 3))).toBe(false);
		expect(isCacheableDiffKey(buildDiffKey({ path: 'a', untracked: true }, 3))).toBe(false);
		// A compare missing one side is not pinned either.
		expect(isCacheableDiffKey(buildDiffKey({ path: 'a', fromHash: 'x' }, 3))).toBe(false);
	});

	it('never caches a commit compared with the working tree', () => {
		expect(
			isCacheableDiffKey(
				buildDiffKey({ path: 'a.ts', fromHash: 'abc', toHash: '*uncommitted*' }, 3)
			)
		).toBe(false);
	});
});

describe('buildDiffKey whitespace', () => {
	it('keys a whitespace-blind diff apart from the plain one', () => {
		const plain = buildDiffKey({ path: 'a.ts', hash: 'abc' }, 3);
		expect(buildDiffKey({ path: 'a.ts', hash: 'abc' }, 3, true)).not.toBe(plain);
		expect(buildDiffKey({ path: 'a.ts', hash: 'abc' }, 3, false)).toBe(plain);
	});
});

describe('rightRevision', () => {
	it('is the commit, the newer side of a comparison, or null for the working tree', () => {
		expect(rightRevision({ path: 'a', hash: 'abc' })).toBe('abc');
		expect(rightRevision({ path: 'a', fromHash: 'abc', toHash: 'def' })).toBe('def');
		expect(rightRevision({ path: 'a', fromHash: 'abc', toHash: '*uncommitted*' })).toBeNull();
		expect(rightRevision({ path: 'a' })).toBeNull();
	});

	it('is undefined for an untracked file', () => {
		expect(rightRevision({ path: 'a', untracked: true })).toBeUndefined();
	});
});

describe('isCacheableDiffKey for blame', () => {
	it('caches a blame at a commit, never the working-tree one', () => {
		expect(isCacheableDiffKey('blame|abc123|src/a.ts')).toBe(true);
		expect(isCacheableDiffKey('blame||src/a.ts')).toBe(false);
	});
});
