import type { BranchRef, Commit } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import { pinnedChain } from './pinnedBranch';

const commit = (hash: string, parents: string[], isUncommitted = false): Commit => ({
	hash,
	parents,
	author: { name: 'A', email: 'a@example.com' },
	committedAt: 0,
	authoredAt: 0,
	subject: hash,
	refs: [],
	...(isUncommitted ? { isUncommitted } : {}),
});

const listCommits = [
	commit('*uncommitted*', ['m2'], true),
	commit('f1', ['m1']),
	commit('m2', ['m1', 'f1']),
	commit('m1', ['m0']),
];
const listBranches: BranchRef[] = [
	{ name: 'main', hash: 'm2', remote: false },
	{ name: 'origin/main', hash: 'm1', remote: true },
];

describe('pinnedChain', () => {
	it('follows first parents from the tip through what is loaded', () => {
		expect([...pinnedChain(listCommits, listBranches, 'origin/main')]).toEqual(['m1']);
	});

	it('takes the Uncommitted row along when the pinned branch is checked out', () => {
		expect(pinnedChain(listCommits, listBranches, 'main')).toEqual(
			new Set(['m2', 'm1', '*uncommitted*'])
		);
	});

	it('is empty with no pin, or a pin that is not in the graph', () => {
		expect(pinnedChain(listCommits, listBranches, null).size).toBe(0);
		expect(pinnedChain(listCommits, listBranches, 'gone').size).toBe(0);
	});
});
