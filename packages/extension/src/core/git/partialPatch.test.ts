import type { SelectedDiffLine } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import { buildPartialPatch } from './partialPatch';

const HEADER = [
	'diff --git a/f.txt b/f.txt',
	'index 1111111..2222222 100644',
	'--- a/f.txt',
	'+++ b/f.txt',
];

/** Old file: a b c d e. New file: a B c d E f — two separate changes in one hunk. */
const DIFF = [
	...HEADER,
	'@@ -1,5 +1,6 @@',
	' a',
	'-b',
	'+B',
	' c',
	' d',
	'-e',
	'+E',
	'+f',
	'',
].join('\n');

const add = (newLine: number, text: string): SelectedDiffLine => ({
	kind: 'add',
	oldLine: null,
	newLine,
	text,
});
const del = (oldLine: number, text: string): SelectedDiffLine => ({
	kind: 'del',
	oldLine,
	newLine: null,
	text,
});

function body(result: ReturnType<typeof buildPartialPatch>): string[] {
	if ('error' in result) throw new Error(result.error);
	return result.patch.trimEnd().split('\n').slice(HEADER.length);
}

describe('buildPartialPatch forward (stage)', () => {
	it('keeps only the picked change: other additions dropped, other deletions kept as context', () => {
		expect(body(buildPartialPatch(DIFF, [del(2, 'b'), add(2, 'B')], 'forward'))).toEqual([
			'@@ -1,5 +1,5 @@',
			' a',
			'-b',
			'+B',
			' c',
			' d',
			' e',
		]);
	});

	it('can take a single added line on its own', () => {
		expect(body(buildPartialPatch(DIFF, [add(6, 'f')], 'forward'))).toEqual([
			'@@ -1,5 +1,6 @@',
			' a',
			' b',
			' c',
			' d',
			' e',
			'+f',
		]);
	});

	it('keeps the file header untouched', () => {
		const result = buildPartialPatch(DIFF, [add(6, 'f')], 'forward');
		if ('error' in result) throw new Error(result.error);
		expect(result.patch.split('\n').slice(0, HEADER.length)).toEqual(HEADER);
	});
});

describe('buildPartialPatch reverse (unstage, discard)', () => {
	it('keeps unpicked additions as context and drops unpicked deletions', () => {
		expect(body(buildPartialPatch(DIFF, [del(5, 'e'), add(5, 'E')], 'reverse'))).toEqual([
			'@@ -1,6 +1,6 @@',
			' a',
			' B',
			' c',
			' d',
			'-e',
			'+E',
			' f',
		]);
	});
});

describe('buildPartialPatch edge cases', () => {
	it('leaves out a hunk with nothing picked in it', () => {
		const twoHunks = [
			...HEADER,
			'@@ -1,2 +1,2 @@',
			'-x',
			'+X',
			' y',
			'@@ -20,2 +20,2 @@ heading',
			' p',
			'-q',
			'+Q',
			'',
		].join('\n');
		expect(body(buildPartialPatch(twoHunks, [add(21, 'Q'), del(21, 'q')], 'forward'))).toEqual([
			'@@ -20,2 +20,2 @@ heading',
			' p',
			'-q',
			'+Q',
		]);
	});

	it('keeps a no-newline marker with the line it belongs to, and drops it with a dropped line', () => {
		const noNewline = [
			...HEADER,
			'@@ -1,2 +1,2 @@',
			' a',
			'-b',
			'\\ No newline at end of file',
			'+c',
			'\\ No newline at end of file',
			'',
		].join('\n');
		// Stage only the deletion: the addition and its marker go, the deleted line keeps its own.
		expect(body(buildPartialPatch(noNewline, [del(2, 'b')], 'forward'))).toEqual([
			'@@ -1,2 +1,1 @@',
			' a',
			'-b',
			'\\ No newline at end of file',
		]);
	});

	it('refuses when a picked line no longer reads the same', () => {
		const result = buildPartialPatch(DIFF, [add(2, 'something else')], 'forward');
		expect(result).toEqual({
			error: 'The file changed after the diff was drawn — look again and pick the lines anew.',
		});
	});

	it('refuses an empty selection and a diff with no hunks', () => {
		expect('error' in buildPartialPatch(DIFF, [], 'forward')).toBe(true);
		expect('error' in buildPartialPatch(HEADER.join('\n'), [add(1, 'a')], 'forward')).toBe(true);
	});
});
