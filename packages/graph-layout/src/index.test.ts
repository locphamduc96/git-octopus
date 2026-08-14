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

function makeUncommitted(parents: string[]): Commit {
	return { ...makeCommit('*uncommitted*', parents), isUncommitted: true };
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
		// the last commit has no parents, so nothing leaves its row
		expect(listRows[2].listOutputLanes.every((lane) => lane === null)).toBe(true);
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

		// M opens a lane in column 1 for its second parent B.
		expect(listRows[0].listOutputLanes[1]?.hash).toBe('b');
		// B sits in column 1 and hands over to C, which column 0 is already waiting for, so B's own
		// column carries nothing out of that row.
		const rowB = listRows[2];
		expect(rowB.listInputLanes[1]?.hash).toBe('b');
		expect(rowB.listOutputLanes[1]).toBeNull();
		expect(rowB.listOutputLanes[0]?.hash).toBe('c');
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

	it('lets a merged branch take a column an open branch has finished with', () => {
		// The checked-out branch `b1` holds column 0 until it merges into master. `g1` merges in a
		// row later, so it can have that column back — leaving it empty would waste it for the whole
		// graph. The still-open `o1` further down keeps a column of its own regardless.
		const listRows = layoutCommits([
			makeUncommitted(['b1']),
			makeCommit('m1', ['m2', 'b1']),
			makeBranchTip('b1', ['m2'], 'feature/merged'),
			makeCommit('m2', ['m3', 'g1']),
			makeCommit('g1', ['m3']),
			makeCommit('m3', ['m4']),
			makeBranchTip('o1', ['m4'], 'feature/open'),
			makeCommit('m4', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.b1).toBe(0);
		expect(mapColumn.m1).toBe(1);
		expect(mapColumn.g1).toBe(0);
		expect(mapColumn.o1).toBe(2);
		expect(graphWidth(listRows)).toBe(3);
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

	it('reports the column of a parent another lane is already waiting for', () => {
		// `b` ends by handing over to `c`, which column 0 already expects. No lane opens for it, so
		// without this the row says nothing links `b` to anything and its node is left hanging.
		const listRows = layoutCommits([
			makeCommit('m', ['a', 'b']),
			makeCommit('a', ['c']),
			makeCommit('b', ['c']),
			makeCommit('c', []),
		]);
		const mapRow = Object.fromEntries(listRows.map((row) => [row.commit.hash, row]));
		expect(mapRow.b.nodeColumn).toBe(1);
		expect(mapRow.b.listParentColumns).toEqual([0]);
		// A merge names both: its own column carries the first parent, the second opens a lane.
		expect(mapRow.m.listParentColumns).toEqual([0, 1]);
		// A root commit has nowhere to go.
		expect(mapRow.c.listParentColumns).toEqual([]);
	});

	it('hands every row the lanes the row above it let out', () => {
		// The view draws each row on its own, from its top edge to its bottom edge. That only lines up
		// if what leaves one row is exactly what enters the next, column for column and colour for
		// colour — so this invariant is what keeps the drawing seamless, not the drawing code.
		const listRows = layoutCommits([
			makeUncommitted(['m1']),
			makeBranchTip('m1', ['m2', 'f1'], 'master'),
			makeCommit('f1', ['m2']),
			makeCommit('m2', ['m3', 'g1']),
			makeBranchTip('g1', ['m3'], 'feature/open'),
			makeCommit('m3', []),
		]);
		for (let i = 0; i < listRows.length - 1; i++) {
			const listOut = listRows[i].listOutputLanes;
			const listIn = listRows[i + 1].listInputLanes;
			const width = Math.max(listOut.length, listIn.length);
			for (let column = 0; column < width; column++) {
				expect([i, column, listIn[column] ?? null]).toEqual([i, column, listOut[column] ?? null]);
			}
		}
	});

	it('assigns distinct colours to diverging branches', () => {
		const listRows = layoutCommits([
			makeCommit('m', ['a', 'b']),
			makeCommit('a', []),
			makeCommit('b', []),
		]);
		const branchLane = listRows[0].listOutputLanes[1];
		expect(branchLane).toBeDefined();
		expect(branchLane?.colour).not.toBe(listRows[0].nodeColour);
	});
});
