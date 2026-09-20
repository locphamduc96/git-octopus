import { describe, expect, it } from 'vitest';
import { parseStatus } from './statusParser.js';

/** Build a v2 "ordinary" entry: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`. */
function ordinary(xy: string, path: string): string {
	return `1 ${xy} N... 100644 100644 100644 aaa bbb ${path}`;
}

/** `--branch` puts these two lines ahead of the entries; the rest of the fixture follows. */
function withHead(oid: string, head: string, ...listEntries: string[]): string {
	return [`# branch.oid ${oid}`, `# branch.head ${head}`, ...listEntries, ''].join('\0');
}

describe('parseStatus', () => {
	it('splits staged (X) and unstaged (Y) changes', () => {
		const output = [ordinary('M.', 'staged.ts'), ordinary('.M', 'unstaged.ts'), ''].join('\0');
		const { staged, unstaged } = parseStatus(output).working;
		expect(staged).toEqual([{ status: 'M', path: 'staged.ts', oldPath: undefined }]);
		expect(unstaged).toEqual([{ status: 'M', path: 'unstaged.ts' }]);
	});

	it('reports a file modified in both index and working tree twice', () => {
		const { staged, unstaged } = parseStatus(`${ordinary('MM', 'both.ts')}\0`).working;
		expect(staged).toHaveLength(1);
		expect(unstaged).toHaveLength(1);
	});

	it('treats untracked entries as unstaged with status ?', () => {
		const { staged, unstaged } = parseStatus('? new-file.ts\0').working;
		expect(staged).toEqual([]);
		expect(unstaged).toEqual([{ status: '?', path: 'new-file.ts' }]);
	});

	it('returns empty lists for a clean tree', () => {
		expect(parseStatus('').working).toEqual({ staged: [], unstaged: [] });
	});
});

describe('parseStatus HEAD headers', () => {
	it('names the branch a repository with commits is on', () => {
		const result = parseStatus(withHead('b69925a', 'main'));
		expect(result.branch).toBe('main');
		expect(result.isUnborn).toBe(false);
	});

	it('reads (initial) as a branch that has no commits yet, keeping its name', () => {
		// The whole point of the distinction: unborn still has a name to show, so reporting it as
		// "no branch" would draw a detached HEAD over a repository that is not detached.
		const result = parseStatus(withHead('(initial)', 'main', '? README.md'));
		expect(result.isUnborn).toBe(true);
		expect(result.branch).toBe('main');
		expect(result.working.unstaged).toEqual([{ status: '?', path: 'README.md' }]);
	});

	it('reads (detached) as no branch, and it is not unborn', () => {
		const result = parseStatus(withHead('55f6846', '(detached)'));
		expect(result.branch).toBeNull();
		expect(result.isUnborn).toBe(false);
	});

	it('parses entries fine when the headers are absent', () => {
		const result = parseStatus(`${ordinary('M.', 'staged.ts')}\0`);
		expect(result.working.staged).toHaveLength(1);
		expect(result.branch).toBeNull();
		expect(result.isUnborn).toBe(false);
	});

	it('ignores the other headers --branch emits', () => {
		const output = [
			'# branch.oid b69925a',
			'# branch.head main',
			'# branch.upstream origin/main',
			'# branch.ab +1 -0',
			ordinary('M.', 'staged.ts'),
			'',
		].join('\0');
		const result = parseStatus(output);
		expect(result.branch).toBe('main');
		expect(result.working.staged).toHaveLength(1);
	});
});
