import type { Commit, GraphRow, Ref } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import { ghostBranchFor, mapLaneBranches } from './ghostBranch';

function row(hash: string, nodeBranch: number, refs: Ref[] = []): GraphRow {
	const commit: Commit = {
		hash,
		parents: [],
		author: { name: 'A', email: 'a@example.com' },
		committedAt: 0,
		authoredAt: 0,
		subject: 'subject',
		refs,
	};
	return {
		commit,
		nodeColumn: 0,
		nodeColour: 0,
		nodeBranch,
		listInputLanes: [],
		listOutputLanes: [],
		listParentColumns: [],
	};
}

describe('mapLaneBranches', () => {
	it('names a lane after the newest branch chip drawn on it', () => {
		const listRows = [
			row('a', 1, [{ kind: 'branch', name: 'main' }]),
			row('b', 1),
			row('c', 2, [{ kind: 'branch', name: 'dev' }]),
		];
		expect(mapLaneBranches(listRows)).toEqual({ 1: 'main', 2: 'dev' });
	});

	// Newest first, so a branch further down the same lane does not overwrite the tip's name.
	it('keeps the first name it finds on a lane', () => {
		const listRows = [
			row('a', 1, [{ kind: 'branch', name: 'main' }]),
			row('b', 1, [{ kind: 'branch', name: 'older' }]),
		];
		expect(mapLaneBranches(listRows)).toEqual({ 1: 'main' });
	});

	// `origin/main` names the same line from the other side; as a ghost it reads as another branch.
	it('ignores remote-tracking refs', () => {
		const listRows = [
			row('a', 1, [{ kind: 'branch', name: 'main', remote: 'origin' }]),
			row('b', 1, [{ kind: 'branch', name: 'main' }]),
		];
		expect(mapLaneBranches(listRows)).toEqual({ 1: 'main' });
	});

	it('ignores tags and stashes', () => {
		const listRows = [row('a', 1, [{ kind: 'tag', name: 'v1' }]), row('b', 1)];
		expect(mapLaneBranches(listRows)).toEqual({});
	});

	it('leaves a lane with no branch on it unnamed', () => {
		expect(mapLaneBranches([row('a', 3)])).toEqual({});
	});
});

describe('ghostBranchFor', () => {
	const mapNames = { 1: 'main' };

	it('names the lane of a commit carrying no ref', () => {
		expect(ghostBranchFor(row('b', 1), mapNames)).toBe('main');
	});

	// The chip already says it; a ghost repeating it reads as a second, different ref.
	it('says nothing for a commit that has a branch chip of its own', () => {
		expect(ghostBranchFor(row('a', 1, [{ kind: 'branch', name: 'main' }]), mapNames)).toBeNull();
	});

	it('says nothing for a commit whose only ref is a remote branch, which is still a chip', () => {
		const target = row('a', 1, [{ kind: 'branch', name: 'main', remote: 'origin' }]);
		expect(ghostBranchFor(target, mapNames)).toBeNull();
	});

	it('still names the lane for a commit carrying only a tag', () => {
		expect(ghostBranchFor(row('b', 1, [{ kind: 'tag', name: 'v1' }]), mapNames)).toBe('main');
	});

	it('says nothing when the lane has no name', () => {
		expect(ghostBranchFor(row('b', 9), mapNames)).toBeNull();
	});
});
