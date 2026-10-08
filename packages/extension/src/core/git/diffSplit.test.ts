import { describe, expect, it } from 'vitest';
import { chunkPaths, splitDiffByPath } from './diffSplit';

/** Real `git diff-index -p --no-renames HEAD` shape, three files, one of them with a space in its name. */
const OUTPUT = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 1111111..2222222 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1 +1,2 @@',
	' one',
	'+two',
	'diff --git a/with space.ts b/with space.ts',
	'index 3333333..4444444 100644',
	'--- a/with space.ts',
	'+++ b/with space.ts',
	'@@ -1 +1 @@',
	'-old',
	'+new',
	'diff --git a/héllo.ts b/héllo.ts',
	'new file mode 100644',
	'--- /dev/null',
	'+++ b/héllo.ts',
	'@@ -0,0 +1 @@',
	'+hi',
].join('\n');

describe('splitDiffByPath', () => {
	it('gives each requested path its own text, header included', () => {
		const map = splitDiffByPath(OUTPUT, ['src/a.ts', 'with space.ts', 'héllo.ts']);
		expect([...map.keys()].sort()).toEqual(['héllo.ts', 'src/a.ts', 'with space.ts']);
		expect(map.get('src/a.ts')).toBe(
			[
				'diff --git a/src/a.ts b/src/a.ts',
				'index 1111111..2222222 100644',
				'--- a/src/a.ts',
				'+++ b/src/a.ts',
				'@@ -1 +1,2 @@',
				' one',
				'+two',
			].join('\n')
		);
	});

	it('reads a path with a space, which the header alone cannot disambiguate', () => {
		const map = splitDiffByPath(OUTPUT, ['with space.ts']);
		expect(map.get('with space.ts')).toContain('-old');
		expect(map.get('with space.ts')).toContain('+new');
		// Only what was asked for: the other two files must not leak into this one's text.
		expect(map.get('with space.ts')).not.toContain('src/a.ts');
		expect(map.size).toBe(1);
	});

	it('keeps a non-ASCII path literal, as core.quotePath=false produces it', () => {
		expect(splitDiffByPath(OUTPUT, ['héllo.ts']).get('héllo.ts')).toContain('+hi');
	});

	it('omits a file it was not asked about rather than guessing', () => {
		const map = splitDiffByPath(OUTPUT, ['src/a.ts']);
		expect(map.has('with space.ts')).toBe(false);
		expect(map.size).toBe(1);
	});

	it('handles an empty diff and an empty path list', () => {
		expect(splitDiffByPath('', ['a.ts']).size).toBe(0);
		expect(splitDiffByPath(OUTPUT, []).size).toBe(0);
	});

	it('keeps a binary notice with its file', () => {
		const output = [
			'diff --git a/logo.png b/logo.png',
			'index 111..222 100644',
			'Binary files a/logo.png and b/logo.png differ',
		].join('\n');
		expect(splitDiffByPath(output, ['logo.png']).get('logo.png')).toContain('Binary files');
	});
});

describe('chunkPaths', () => {
	it('keeps everything in one call when it fits', () => {
		expect(chunkPaths(['a.ts', 'b.ts'], 1000)).toEqual([['a.ts', 'b.ts']]);
	});

	it('splits once the argv budget is spent', () => {
		// Each path costs its bytes plus one separator, so 'aaaa' is 5.
		expect(chunkPaths(['aaaa', 'bbbb', 'cccc'], 10)).toEqual([['aaaa', 'bbbb'], ['cccc']]);
	});

	it('still emits a path that is bigger than the whole budget', () => {
		const long = 'x'.repeat(50);
		expect(chunkPaths([long], 10)).toEqual([[long]]);
	});

	it('measures bytes, not characters', () => {
		// 'é' is two bytes in UTF-8, so two of these cost 6, not 4.
		expect(chunkPaths(['é', 'é'], 5)).toEqual([['é'], ['é']]);
	});

	it('has nothing to do with no paths', () => {
		expect(chunkPaths([], 10)).toEqual([]);
	});
});
