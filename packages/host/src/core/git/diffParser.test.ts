import { describe, expect, it } from 'vitest';
import { countDiffLines, isBinaryDiff, parseUnifiedDiff } from './diffParser';

const DIFF = [
	'diff --git a/src/app.ts b/src/app.ts',
	'index 1234567..89abcde 100644',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -10,6 +10,7 @@ export function start() {',
	' const a = 1;',
	'-const b = 2;',
	'+const b = 3;',
	'+const c = 4;',
	' return a;',
	'',
].join('\n');

describe('parseUnifiedDiff', () => {
	it('keeps the hunk position and its section heading', () => {
		const [hunk] = parseUnifiedDiff(DIFF);
		expect(hunk.oldStart).toBe(10);
		expect(hunk.newStart).toBe(10);
		expect(hunk.heading).toBe('export function start() {');
	});

	it('numbers each side independently', () => {
		const [hunk] = parseUnifiedDiff(DIFF);
		expect(hunk.listLines).toEqual([
			{ kind: 'context', text: 'const a = 1;', oldLine: 10, newLine: 10 },
			{ kind: 'del', text: 'const b = 2;', oldLine: 11, newLine: null },
			{ kind: 'add', text: 'const b = 3;', oldLine: null, newLine: 11 },
			{ kind: 'add', text: 'const c = 4;', oldLine: null, newLine: 12 },
			{ kind: 'context', text: 'return a;', oldLine: 12, newLine: 13 },
		]);
	});

	it('drops the preamble, so nothing before the first hunk is read as content', () => {
		expect(parseUnifiedDiff(DIFF)).toHaveLength(1);
		expect(parseUnifiedDiff('diff --git a/x b/x\nindex 1..2 100644\n')).toEqual([]);
	});

	it('ignores the no-final-newline marker rather than printing it as a line', () => {
		const output = ['@@ -1 +1 @@', '-a', '+b', '\\ No newline at end of file'].join('\n');
		expect(parseUnifiedDiff(output)[0].listLines.map((line) => line.text)).toEqual(['a', 'b']);
	});

	it('reads a hunk header without line counts, which git omits for single lines', () => {
		const [hunk] = parseUnifiedDiff(['@@ -7 +7 @@', '-a', '+b'].join('\n'));
		expect([hunk.oldStart, hunk.newStart]).toEqual([7, 7]);
	});

	it('parses several hunks of the same file', () => {
		const output = [
			'@@ -1,2 +1,2 @@',
			'-a',
			'+b',
			' c',
			'@@ -20,2 +20,2 @@',
			' d',
			'-e',
			'+f',
		].join('\n');
		const listHunks = parseUnifiedDiff(output);
		expect(listHunks.map((hunk) => hunk.oldStart)).toEqual([1, 20]);
		expect(countDiffLines(listHunks)).toBe(6);
	});

	it('keeps a blank context line, which prints as a single space', () => {
		const [hunk] = parseUnifiedDiff(['@@ -1,3 +1,3 @@', ' a', ' ', '-b', '+c'].join('\n'));
		expect(hunk.listLines[1]).toEqual({ kind: 'context', text: '', oldLine: 2, newLine: 2 });
	});
});

describe('isBinaryDiff', () => {
	it('recognises both forms git uses to refuse a text diff', () => {
		expect(isBinaryDiff('Binary files a/logo.png and b/logo.png differ')).toBe(true);
		expect(isBinaryDiff('GIT binary patch\nliteral 120')).toBe(true);
		expect(isBinaryDiff(DIFF)).toBe(false);
	});
});
