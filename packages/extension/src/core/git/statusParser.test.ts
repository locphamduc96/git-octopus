import { describe, expect, it } from 'vitest';
import { parseStatus } from './statusParser.js';

/** Build a v2 "ordinary" entry: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`. */
function ordinary(xy: string, path: string): string {
	return `1 ${xy} N... 100644 100644 100644 aaa bbb ${path}`;
}

describe('parseStatus', () => {
	it('splits staged (X) and unstaged (Y) changes', () => {
		const output = [ordinary('M.', 'staged.ts'), ordinary('.M', 'unstaged.ts'), ''].join('\0');
		const { staged, unstaged } = parseStatus(output);
		expect(staged).toEqual([{ status: 'M', path: 'staged.ts', oldPath: undefined }]);
		expect(unstaged).toEqual([{ status: 'M', path: 'unstaged.ts' }]);
	});

	it('reports a file modified in both index and working tree twice', () => {
		const { staged, unstaged } = parseStatus(`${ordinary('MM', 'both.ts')}\0`);
		expect(staged).toHaveLength(1);
		expect(unstaged).toHaveLength(1);
	});

	it('treats untracked entries as unstaged with status ?', () => {
		const { staged, unstaged } = parseStatus('? new-file.ts\0');
		expect(staged).toEqual([]);
		expect(unstaged).toEqual([{ status: '?', path: 'new-file.ts' }]);
	});

	it('returns empty lists for a clean tree', () => {
		expect(parseStatus('')).toEqual({ staged: [], unstaged: [] });
	});
});
