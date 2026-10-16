import { describe, expect, it } from 'vitest';
import { classifyChanges, globToRegExp, MAX_SOURCE_BYTES } from './classifyChanges.js';

function tierOf(path: string, bytes?: number, listExclude: string[] = []): string {
	return classifyChanges([{ path, status: 'M', bytes }], listExclude)[0].tier;
}

describe('classifyChanges', () => {
	it('keeps real code in the source tier', () => {
		expect(tierOf('src/app/main.ts', 1200)).toBe('source');
		expect(tierOf('README.md', 300)).toBe('source');
	});

	it('marks editor-owned and generated files as asset regardless of size', () => {
		expect(tierOf('assets/scenes/battle.scene', 120)).toBe('asset');
		expect(tierOf('assets/hero.png.meta', 90)).toBe('asset');
		expect(tierOf('pnpm-lock.yaml', 500)).toBe('asset');
		expect(tierOf('web/dist/bundle.js', 10)).toBe('asset');
	});

	it('demotes oversized text to asset — at that size it is data, not a change to read', () => {
		expect(tierOf('data/levels.json', MAX_SOURCE_BYTES + 1)).toBe('asset');
		expect(tierOf('data/levels.json', 100)).toBe('source');
	});

	it('marks binaries by extension, deleted files (no size) staying classifiable', () => {
		expect(tierOf('assets/hero.png', 40_000)).toBe('binary');
		expect(tierOf('assets/hero.png', undefined)).toBe('binary');
	});

	it('lets user exclude patterns beat every other tier', () => {
		expect(tierOf('src/secret/keys.ts', 100, ['src/secret/**'])).toBe('excluded');
		expect(tierOf('notes.env', 10, ['*.env'])).toBe('excluded');
	});
});

describe('globToRegExp', () => {
	it('keeps * inside one path segment and lets ** cross', () => {
		expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
		expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
		expect(globToRegExp('src/**/*.ts').test('src/deep/er/a.ts')).toBe(true);
	});

	it('matches a slashless pattern against the basename anywhere', () => {
		expect(globToRegExp('*.meta').test('a/b/c.png.meta')).toBe(true);
		expect(globToRegExp('*.meta').test('a/b/meta.ts')).toBe(false);
	});
});
