import { describe, expect, it } from 'vitest';
import { buildRefTree, type RefTreeNode } from './refTree';

/** Compact shape for assertions: folders as nested objects, leaves as strings. */
function shape(listNodes: RefTreeNode[]): unknown[] {
	return listNodes.map((node) =>
		node.kind === 'leaf' ? node.fullName : { [node.name]: shape(node.listChildren) }
	);
}

describe('buildRefTree', () => {
	it('keeps flat names as leaves', () => {
		expect(shape(buildRefTree(['main', 'develop']))).toEqual(['develop', 'main']);
	});

	it('groups slash-separated names into folders, folders first', () => {
		expect(shape(buildRefTree(['main', 'feature/b', 'feature/a', 'fix/x']))).toEqual([
			{ feature: ['feature/a', 'feature/b'] },
			{ fix: ['fix/x'] },
			'main',
		]);
	});

	it('nests multi-level prefixes', () => {
		expect(shape(buildRefTree(['team/loc/one', 'team/loc/two', 'team/readme']))).toEqual([
			{ team: [{ loc: ['team/loc/one', 'team/loc/two'] }, 'team/readme'] },
		]);
	});

	it('keeps a leaf whose name is also a folder prefix', () => {
		// A branch "release" and branches under "release/…" can coexist in git.
		expect(shape(buildRefTree(['release', 'release/1.0']))).toEqual([
			{ release: ['release/1.0'] },
			'release',
		]);
	});

	it('handles empty input', () => {
		expect(buildRefTree([])).toEqual([]);
	});
});
