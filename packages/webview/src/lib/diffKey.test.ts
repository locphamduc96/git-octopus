import { describe, expect, it } from 'vitest';
import { buildDiffKey, isCacheableDiffKey } from './diffKey';

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
});
