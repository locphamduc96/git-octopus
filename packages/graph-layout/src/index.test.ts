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

/** A commit carrying a branch ref — an open branch tip when nothing in the graph descends from it. */
function makeBranchTip(hash: string, parents: string[], name: string): Commit {
	return { ...makeCommit(hash, parents), refs: [{ kind: 'branch', name }] };
}

function makeStash(hash: string, parents: string[], name: string): Commit {
	return { ...makeCommit(hash, parents), refs: [{ kind: 'stash', name }] };
}

function mapColumnsByHash(listRows: ReturnType<typeof layoutCommits>): Record<string, number> {
	return Object.fromEntries(listRows.map((row) => [row.commit.hash, row.nodeColumn]));
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

	it('keeps an open branch out of a column a closed branch has already used', () => {
		// `f1` is a branch that was merged and closed, freeing column 1. `g1` is still open, so it
		// must not inherit that column — the two would read as one line running down the graph.
		const listRows = layoutCommits([
			makeCommit('merge', ['t2', 'f1']),
			makeCommit('t2', ['t3']),
			makeCommit('f1', ['t3']),
			makeCommit('t3', ['t4']),
			makeBranchTip('g1', ['t4'], 'feature/open'),
			makeCommit('t4', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.f1).toBe(1);
		expect(mapColumn.g1).not.toBe(mapColumn.f1);
		expect(mapColumn.g1).not.toBe(mapColumn.merge);
	});

	it('gives two open branches separate columns even when the first ends before the second starts', () => {
		const listRows = layoutCommits([
			makeBranchTip('t1', ['t2'], 'master'),
			makeBranchTip('b1', ['t2'], 'feature/a'),
			makeCommit('t2', ['t3']),
			makeBranchTip('c1', ['t3'], 'feature/b'),
			makeCommit('t3', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.t1).toBe(0);
		expect(mapColumn.b1).toBe(1);
		expect(mapColumn.c1).toBe(2);
	});

	it('still lets closed branches share a column so the graph stays narrow', () => {
		// Neither branch is open (each is consumed by a merge), so both can live in column 1.
		const listRows = layoutCommits([
			makeCommit('mA', ['c1', 'x1']),
			makeCommit('x1', ['c1']),
			makeCommit('c1', ['c2', 'y1']),
			makeCommit('y1', ['c2']),
			makeCommit('c2', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.x1).toBe(1);
		expect(mapColumn.y1).toBe(1);
		expect(graphWidth(listRows)).toBe(2);
	});

	it('does not reserve a column for stashes, which are not open branches', () => {
		const listRows = layoutCommits([
			makeBranchTip('h1', ['h2'], 'master'),
			makeStash('s1', ['h2'], 'stash@{0}'),
			makeCommit('h2', ['h3']),
			makeStash('s2', ['h3'], 'stash@{1}'),
			makeCommit('h3', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.s1).toBe(1);
		expect(mapColumn.s2).toBe(1);
		expect(graphWidth(listRows)).toBe(2);
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
