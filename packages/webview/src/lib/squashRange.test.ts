import { describe, expect, it } from 'vitest';
import type { Commit, GraphRow, Ref } from '@git-octopus/shared';
import { isSquashableChain, selectRange } from './squashRange';

function commit(hash: string, parents: string[], refs: Ref[] = []): Commit {
	return {
		hash,
		parents,
		author: { name: 'a', email: 'a@example.com' },
		committedAt: 0,
		authoredAt: 0,
		subject: `subject ${hash}`,
		refs,
	};
}

function row(c: Commit): GraphRow {
	return {
		commit: c,
		nodeColumn: 0,
		nodeColour: 0,
		nodeBranch: 0,
		listInputLanes: [],
		listOutputLanes: [],
		listParentColumns: [0],
	};
}

const listRows: GraphRow[] = [
	row(commit('d', ['c'])),
	row(commit('c', ['b'])),
	row(commit('b', ['a'])),
	row(commit('a', ['root'])),
];

describe('selectRange', () => {
	it('covers anchor to target inclusive, in row order', () => {
		expect(selectRange(listRows, 'c', 'a')).toEqual(['c', 'b', 'a']);
	});

	it('works with the anchor below the target', () => {
		expect(selectRange(listRows, 'a', 'c')).toEqual(['c', 'b', 'a']);
	});

	it('falls back to the target alone without an anchor', () => {
		expect(selectRange(listRows, null, 'b')).toEqual(['b']);
	});

	it('drops the uncommitted node and stashes from the range', () => {
		const uncommitted = commit('u', ['d']);
		uncommitted.isUncommitted = true;
		const stash = commit('s', ['c'], [{ kind: 'stash', name: 'stash@{0}' }]);
		const listMixed = [
			row(uncommitted),
			row(commit('d', ['c'])),
			row(stash),
			row(commit('c', ['b'])),
		];
		expect(selectRange(listMixed, 'u', 'c')).toEqual(['d', 'c']);
	});

	it('returns empty when the target is missing', () => {
		expect(selectRange(listRows, 'c', 'zzz')).toEqual([]);
	});
});

describe('isSquashableChain', () => {
	const mapByHash = new Map(listRows.map((r) => [r.commit.hash, r.commit]));
	const pick = (...hashes: string[]) => hashes.map((hash) => mapByHash.get(hash)!);

	it('accepts a contiguous first-parent run', () => {
		expect(isSquashableChain(pick('c', 'b', 'a'))).toBe(true);
	});

	it('rejects a single commit', () => {
		expect(isSquashableChain(pick('c'))).toBe(false);
	});

	it('rejects a gap in the run', () => {
		expect(isSquashableChain(pick('d', 'b'))).toBe(false);
	});

	it('rejects merge commits', () => {
		expect(isSquashableChain([commit('m', ['c', 'x']), mapByHash.get('c')!])).toBe(false);
	});

	it('rejects a root commit', () => {
		expect(isSquashableChain([commit('b', ['a']), commit('a', [])])).toBe(false);
	});
});
