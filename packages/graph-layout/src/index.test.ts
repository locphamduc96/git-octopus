import { describe, expect, it } from 'vitest';
import type { Commit } from '@git-octopus/shared';
import { graphWidth, layoutCommits } from './index.js';

function makeCommit(hash: string, parents: string[]): Commit {
	return {
		hash,
		parents,
		author: { name: 'Test', email: 'test@example.com' },
		committedAt: 0,
		authoredAt: 0,
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
		// B goes on waiting for C in its own column rather than stepping across to column 0 here, so
		// the branch runs beside the trunk all the way down to the commit they share.
		const rowB = listRows[2];
		expect(rowB.listInputLanes[1]?.hash).toBe('b');
		expect(rowB.listOutputLanes[1]?.hash).toBe('c');
		// The two lanes meet at C, whose node sits on the trunk; column 1 arrives into it.
		const rowC = listRows[3];
		expect(rowC.nodeColumn).toBe(0);
		expect(rowC.listInputLanes[1]?.hash).toBe('c');
	});

	it('gives every commit exactly one row', () => {
		const listCommits = [makeCommit('a', ['b']), makeCommit('b', [])];
		expect(layoutCommits(listCommits)).toHaveLength(2);
	});

	it('lets a new tip reuse the gap a finished branch released', () => {
		// `a` ends at `x` while `b` is still open, leaving column 0 free. `c` takes that gap: a tip
		// has no edge from above and a fresh colour, so it cannot be mistaken for `a` carrying on —
		// and the graph stays as narrow as the number of concurrent lanes.
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
		expect(mapColumn.c).toBe(0);
		expect(graphWidth(listRows)).toBe(2);
	});

	it('reuses a lane once it is free at the right edge, keeping the graph narrow', () => {
		// Each branch closes before the next opens, so the same column can serve all of them.
		const listRows = layoutCommits([makeCommit('a', []), makeCommit('b', []), makeCommit('c', [])]);
		expect(listRows.map((r) => r.nodeColumn)).toEqual([0, 0, 0]);
		expect(graphWidth(listRows)).toBe(1);
	});

	it('lets an open branch take a column a finished branch released', () => {
		// `f1` was merged and its lane closed at t3, freeing column 1 — `g1` moves in rather than
		// widening the graph. Its node has no edge from above, so the two lanes stay distinct.
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
		expect(mapColumn.g1).toBe(1);
		expect(graphWidth(listRows)).toBe(2);
	});

	it('reuses one column for open branches whose spans do not overlap', () => {
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
		// b1's lane closed at t2, so c1 takes column 1 back instead of opening column 2.
		expect(mapColumn.c1).toBe(1);
		expect(graphWidth(listRows)).toBe(2);
	});

	it('does not widen the graph by one column per stale branch', () => {
		// The pathology this policy exists for: a repo accumulating never-merged, forgotten branches.
		// Their spans do not overlap, so they all share one column beside the trunk.
		const listRows = layoutCommits([
			makeBranchTip('main1', ['t1'], 'main'),
			makeCommit('t1', ['t2']),
			makeBranchTip('s1', ['t2'], 'stale/one'),
			makeCommit('t2', ['t3']),
			makeBranchTip('s2', ['t3'], 'stale/two'),
			makeCommit('t3', []),
		]);
		const mapColumn = mapColumnsByHash(listRows);
		expect(mapColumn.s1).toBe(1);
		expect(mapColumn.s2).toBe(1);
		expect(graphWidth(listRows)).toBe(2);
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
		// Every branch here runs beside the trunk down to the commit it merges at, so a column only
		// comes free once that meeting point is passed. `g1` opens after master's lane has met `b1`'s
		// at m2, so it takes that column back rather than widening the graph — and so does the open
		// `o1` further down, once g1's lane has closed at m3.
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
		expect(mapColumn.g1).toBe(1);
		expect(mapColumn.o1).toBe(1);
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

	it('names the column each parent leaves in, lane or no lane', () => {
		// A merge whose second parent another lane already awaits opens no lane of its own, so without
		// this the row would record nothing linking the merge to it and the line would be missing.
		const listRows = layoutCommits([
			makeCommit('m1', ['t1', 'x']),
			makeCommit('t1', ['t2', 'x']),
			makeCommit('x', ['t2']),
			makeCommit('t2', []),
		]);
		const mapRow = Object.fromEntries(listRows.map((row) => [row.commit.hash, row]));
		// m1 opens column 1 for x; t1 merges the same x, which is already waiting there.
		expect(mapRow.m1.listParentColumns).toEqual([0, 1]);
		expect(mapRow.t1.listParentColumns).toEqual([0, 1]);
		expect(mapRow.t1.listOutputLanes[1]?.hash).toBe('x');
		// A root commit has nowhere to go.
		expect(mapRow.t2.listParentColumns).toEqual([]);
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

	it('keeps one branch identity along a first-parent chain', () => {
		const listRows = layoutCommits([
			makeCommit('a', ['b']),
			makeCommit('b', ['c']),
			makeCommit('c', []),
		]);
		const listBranches = listRows.map((row) => row.nodeBranch);
		expect(listBranches[0]).toBe(listBranches[1]);
		expect(listBranches[1]).toBe(listBranches[2]);
	});

	it('gives a merged-in branch its own identity, distinct even when colours repeat', () => {
		// M merges B; the lane M opens for B is a different branch line than the trunk.
		const listRows = layoutCommits([
			makeCommit('m', ['a', 'b']),
			makeCommit('a', ['c']),
			makeCommit('b', ['c']),
			makeCommit('c', []),
		]);
		const trunk = listRows[0].nodeBranch;
		const branchLane = listRows[0].listOutputLanes[1];
		expect(branchLane?.branch).not.toBe(trunk);
		// B's node sits on that lane and carries its identity down to the shared parent.
		expect(listRows[2].nodeBranch).toBe(branchLane?.branch);
		// C is on the trunk's first-parent chain.
		expect(listRows[3].nodeBranch).toBe(trunk);
	});

	it('never reuses a branch identity for a new lane', () => {
		// Two short-lived branches, one after the other: colours may repeat, identities must not.
		const listRows = layoutCommits([
			makeCommit('m2', ['m1', 's2']),
			makeCommit('s2', ['m1']),
			makeCommit('m1', ['m0', 's1']),
			makeCommit('s1', ['m0']),
			makeCommit('m0', []),
		]);
		const first = listRows[2].listOutputLanes[1]?.branch;
		const second = listRows[0].listOutputLanes[1]?.branch;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(second).not.toBe(first);
		expect(second).not.toBe(listRows[0].nodeBranch);
	});
});
