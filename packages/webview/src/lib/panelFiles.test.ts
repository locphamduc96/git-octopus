import { describe, expect, it } from 'vitest';
import type { CommitDetails, FileChange, WorkingTreeStatus } from '@git-octopus/shared';
import { buildFileTree } from './fileTree';
import { buildPanelFiles, flattenTree, stepPath } from './panelFiles';

function file(path: string, status: FileChange['status'] = 'M'): FileChange {
	return { path, status };
}

const working: WorkingTreeStatus = {
	unstaged: [file('z/untracked.ts', '?'), file('b.ts'), file('conflict.ts', 'U'), file('a.ts')],
	staged: [file('staged.ts')],
};

describe('buildPanelFiles', () => {
	it('joins the working-tree sections in display order: conflicts, changes, untracked, staged', () => {
		const listPaths = buildPanelFiles({
			mode: 'changes',
			working,
			details: null,
			listComparisonFiles: [],
			fileView: 'list',
		}).map((f) => f.path);
		expect(listPaths).toEqual(['conflict.ts', 'b.ts', 'a.ts', 'z/untracked.ts', 'staged.ts']);
	});

	it('follows the tree within each section when the view is a tree', () => {
		const listPaths = buildPanelFiles({
			mode: 'changes',
			working,
			details: null,
			listComparisonFiles: [],
			fileView: 'tree',
		}).map((f) => f.path);
		// Tree view sorts names, but a section never interleaves with the next one.
		expect(listPaths).toEqual(['conflict.ts', 'a.ts', 'b.ts', 'z/untracked.ts', 'staged.ts']);
	});

	it('lists a commit in its own order in list view and folder order in tree view', () => {
		const details = {
			files: [file('src/z.ts'), file('README.md'), file('src/a.ts')],
		} as CommitDetails;
		const base = { mode: 'commit' as const, working: null, details, listComparisonFiles: [] };
		expect(buildPanelFiles({ ...base, fileView: 'list' }).map((f) => f.path)).toEqual([
			'src/z.ts',
			'README.md',
			'src/a.ts',
		]);
		expect(buildPanelFiles({ ...base, fileView: 'tree' }).map((f) => f.path)).toEqual(
			flattenTree(buildFileTree(details.files)).map((f) => f.path)
		);
	});

	it('uses the comparison files in compare mode and nothing without a working tree', () => {
		const listCompare = [file('x.ts')];
		expect(
			buildPanelFiles({
				mode: 'compare',
				working: null,
				details: null,
				listComparisonFiles: listCompare,
				fileView: 'list',
			})
		).toEqual(listCompare);
		expect(
			buildPanelFiles({
				mode: 'changes',
				working: null,
				details: null,
				listComparisonFiles: listCompare,
				fileView: 'list',
			})
		).toEqual([]);
	});
});

describe('stepPath', () => {
	const listFiles = [file('a'), file('b'), file('c'), file('d')];

	it('steps by one and stops at either edge instead of wrapping', () => {
		expect(stepPath(listFiles, 'b', 'ArrowDown', 20)).toBe('c');
		expect(stepPath(listFiles, 'b', 'ArrowUp', 20)).toBe('a');
		expect(stepPath(listFiles, 'd', 'ArrowDown', 20)).toBeNull();
		expect(stepPath(listFiles, 'a', 'ArrowUp', 20)).toBeNull();
	});

	it('jumps by page and to the ends', () => {
		expect(stepPath(listFiles, 'a', 'PageDown', 2)).toBe('c');
		expect(stepPath(listFiles, 'd', 'PageUp', 2)).toBe('b');
		expect(stepPath(listFiles, 'c', 'Home', 20)).toBe('a');
		expect(stepPath(listFiles, 'a', 'End', 20)).toBe('d');
	});

	it('starts from the top when the current path is gone, and has nowhere to go in an empty list', () => {
		expect(stepPath(listFiles, 'vanished', 'ArrowDown', 20)).toBe('a');
		expect(stepPath(listFiles, null, 'ArrowUp', 20)).toBe('a');
		expect(stepPath([], 'a', 'ArrowDown', 20)).toBeNull();
	});
});
