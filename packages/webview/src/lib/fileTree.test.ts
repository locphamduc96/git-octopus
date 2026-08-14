import { describe, expect, it } from 'vitest';
import type { FileChange } from '@git-octopus/shared';
import { buildFileTree, type FileTreeNode } from './fileTree.js';

function file(path: string): FileChange {
	return { status: 'M', path };
}

/** Render the tree as indented lines, which reads far better than nested object literals. */
function outline(listNodes: FileTreeNode[], depth = 0): string[] {
	return listNodes.flatMap((node) =>
		node.kind === 'folder'
			? [`${'  '.repeat(depth)}${node.name}/`, ...outline(node.children, depth + 1)]
			: [`${'  '.repeat(depth)}${node.name}`]
	);
}

describe('buildFileTree', () => {
	it('nests files under their folders', () => {
		const tree = buildFileTree([file('src/a.ts'), file('src/b.ts'), file('readme.md')]);
		expect(outline(tree)).toEqual(['src/', '  a.ts', '  b.ts', 'readme.md']);
	});

	it('lists folders before files and sorts each alphabetically', () => {
		const tree = buildFileTree([file('z.txt'), file('a.txt'), file('pkg/one.ts')]);
		expect(outline(tree)).toEqual(['pkg/', '  one.ts', 'a.txt', 'z.txt']);
	});

	it('compacts a chain of single-child folders', () => {
		const tree = buildFileTree([file('a/b/c/deep.ts')]);
		expect(outline(tree)).toEqual(['a/b/c/', '  deep.ts']);
	});

	it('stops compacting where a folder branches', () => {
		const tree = buildFileTree([file('a/b/one.ts'), file('a/c/two.ts')]);
		expect(outline(tree)).toEqual(['a/', '  b/', '    one.ts', '  c/', '    two.ts']);
	});

	it('keeps every folder separate when compacting is off', () => {
		const tree = buildFileTree([file('a/b/c/deep.ts')], false);
		expect(outline(tree)).toEqual(['a/', '  b/', '    c/', '      deep.ts']);
	});

	it('gives folders their full path for keying and tooltips', () => {
		const [folder] = buildFileTree([file('src/lib/x.ts')]);
		expect(folder.kind === 'folder' && folder.path).toBe('src/lib');
	});
});
