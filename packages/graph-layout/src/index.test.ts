import { describe, expect, it } from 'vitest';
import type { Commit } from '@git-octopus/shared';
import { graphWidth, layoutCommits } from './index.js';

function makeCommit(hash: string, parents: string[]): Commit {
	return {
		hash,
		parents,
		author: { name: 'Test', email: 'test@example.com' },
		committedAt: 0,
		subject: hash,
		refs: [],
	};
}

describe('layoutCommits', () => {
	it('places a linear history in a single column', () => {
		const listRows = layoutCommits([
			makeCommit('a', ['b']),
			makeCommit('b', ['c']),
			makeCommit('c', []),
		]);
		expect(listRows.map((r) => r.nodeColumn)).toEqual([0, 0, 0]);
		expect(graphWidth(listRows)).toBe(1);
		// last commit (no parents) has no outgoing edges
		expect(listRows[2].edges).toHaveLength(0);
	});

	it('branches a merge onto a second column and merges back', () => {
		// M is a merge of A and B, both children of C.
		const listRows = layoutCommits([
			makeCommit('m', ['a', 'b']),
			makeCommit('a', ['c']),
			makeCommit('b', ['c']),
			makeCommit('c', []),
		]);
		const mapColumn = Object.fromEntries(listRows.map((r) => [r.commit.hash, r.nodeColumn]));
		expect(mapColumn).toEqual({ m: 0, a: 0, b: 1, c: 0 });
		expect(graphWidth(listRows)).toBe(2);

		// M spawns a lane towards column 1 (its second parent B).
		expect(listRows[0].edges.some((e) => e.toColumn === 1)).toBe(true);
		// B (column 1) merges back into column 0 at C.
		const rowB = listRows[2];
		expect(rowB.edges.some((e) => e.fromColumn === 1 && e.toColumn === 0)).toBe(true);
	});

	it('gives every commit exactly one row', () => {
		const listCommits = [makeCommit('a', ['b']), makeCommit('b', [])];
		expect(layoutCommits(listCommits)).toHaveLength(2);
	});

	it('gives a new branch its own lane instead of a gap left by an unrelated one', () => {
		// `a` ends at `x` while `b` is still open, leaving column 0 free. `c` must not drop into it,
		// which would draw two unrelated branches as one continuous line.
		const listRows = layoutCommits([
			makeCommit('a', ['x']),
			makeCommit('b', ['y']),
			makeCommit('x', []),
			makeCommit('c', ['z']),
			makeCommit('y', []),
			makeCommit('z', []),
		]);
		const mapColumn = Object.fromEntries(listRows.map((r) => [r.commit.hash, r.nodeColumn]));
		expect(mapColumn.a).toBe(0);
		expect(mapColumn.b).toBe(1);
		expect(mapColumn.c).not.toBe(mapColumn.a);
		expect(mapColumn.c).not.toBe(mapColumn.b);
	});

	it('reuses a lane once it is free at the right edge, keeping the graph narrow', () => {
		// Each branch closes before the next opens, so the same column can serve all of them.
		const listRows = layoutCommits([
			makeCommit('a', []),
			makeCommit('b', []),
			makeCommit('c', []),
		]);
		expect(listRows.map((r) => r.nodeColumn)).toEqual([0, 0, 0]);
		expect(graphWidth(listRows)).toBe(1);
	});

	it('assigns distinct colours to diverging branches', () => {
		const listRows = layoutCommits([
			makeCommit('m', ['a', 'b']),
			makeCommit('a', []),
			makeCommit('b', []),
		]);
		const mBranchEdge = listRows[0].edges.find((e) => e.toColumn === 1);
		expect(mBranchEdge).toBeDefined();
		expect(mBranchEdge?.colour).not.toBe(listRows[0].nodeColour);
	});
});
