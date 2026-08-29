import { describe, expect, it } from 'vitest';
import type { Commit, Ref } from '@git-octopus/shared';
import { buildRefPayload, commitRefPayload, commitStashName } from './refPayload';
import type { RefChip } from './graphChips';

function commit(listRefs: Ref[]): Commit {
	return {
		hash: 'abc1234',
		parents: [],
		author: { name: 'A', email: 'a@example.com' },
		committedAt: 0,
		authoredAt: 0,
		subject: 'subject',
		refs: listRefs,
	};
}

function chip(over: Partial<RefChip> = {}): RefChip {
	return {
		kind: 'branch',
		name: 'feature',
		checkedOut: false,
		hasLocal: true,
		listRemotes: [],
		title: '',
		...over,
	};
}

describe('buildRefPayload', () => {
	it('sends only the local branch when the target names no remote', () => {
		expect(buildRefPayload({ chip: chip({ listRemotes: ['origin', 'upstream'] }) })).toEqual({
			listBranches: ['feature'],
			listRemoteBranches: [],
			listTags: [],
		});
	});

	it('sends exactly the named remote, never its siblings', () => {
		expect(
			buildRefPayload({
				chip: chip({ listRemotes: ['origin', 'upstream'] }),
				remote: 'upstream',
			})
		).toEqual({
			listBranches: [],
			listRemoteBranches: [{ remote: 'upstream', branch: 'feature' }],
			listTags: [],
		});
	});

	it('leaves the local name out of a remote target, so checkout takes the remote path', () => {
		const payload = buildRefPayload({ chip: chip({ listRemotes: ['origin'] }), remote: 'origin' });
		expect(payload.listBranches).toEqual([]);
	});

	it('sends a tag as a tag, and nothing as a branch', () => {
		expect(buildRefPayload({ chip: chip({ kind: 'tag', name: 'v1', hasLocal: false }) })).toEqual({
			listBranches: [],
			listRemoteBranches: [],
			listTags: ['v1'],
		});
	});

	it('sends no ref at all for a stash or a detached HEAD', () => {
		for (const kind of ['stash', 'head'] as const)
			expect(buildRefPayload({ chip: chip({ kind, hasLocal: false }) })).toEqual({
				listBranches: [],
				listRemoteBranches: [],
				listTags: [],
			});
	});

	it('sends nothing for a remote-only chip whose target names no remote', () => {
		expect(buildRefPayload({ chip: chip({ hasLocal: false, listRemotes: ['origin'] }) })).toEqual({
			listBranches: [],
			listRemoteBranches: [],
			listTags: [],
		});
	});
});

describe('commitRefPayload', () => {
	it('sends a local branch as a branch', () => {
		expect(commitRefPayload(commit([{ kind: 'branch', name: 'main' }]))).toEqual({
			listBranches: ['main'],
			listRemoteBranches: [],
			listTags: [],
		});
	});

	it('sends a remote branch as a remote branch, and not also as a local one', () => {
		expect(
			commitRefPayload(commit([{ kind: 'branch', name: 'main', remote: 'origin' }]))
		).toEqual({
			listBranches: [],
			listRemoteBranches: [{ remote: 'origin', branch: 'main' }],
			listTags: [],
		});
	});

	it('sends a tag as a tag', () => {
		expect(commitRefPayload(commit([{ kind: 'tag', name: 'v1' }]))).toEqual({
			listBranches: [],
			listRemoteBranches: [],
			listTags: ['v1'],
		});
	});

	it('keeps every ref of a mixed commit, and drops stash and HEAD from all three lists', () => {
		expect(
			commitRefPayload(
				commit([
					{ kind: 'head' },
					{ kind: 'branch', name: 'main' },
					{ kind: 'branch', name: 'main', remote: 'origin' },
					{ kind: 'branch', name: 'main', remote: 'upstream' },
					{ kind: 'tag', name: 'v1' },
					{ kind: 'stash', name: 'stash@{0}' },
				])
			)
		).toEqual({
			listBranches: ['main'],
			listRemoteBranches: [
				{ remote: 'origin', branch: 'main' },
				{ remote: 'upstream', branch: 'main' },
			],
			listTags: ['v1'],
		});
	});

	it('sends three empty lists for a commit carrying no ref', () => {
		expect(commitRefPayload(commit([]))).toEqual({
			listBranches: [],
			listRemoteBranches: [],
			listTags: [],
		});
	});

	it('counts a branch with an empty remote as local, never as a remote naming nothing', () => {
		expect(commitRefPayload(commit([{ kind: 'branch', name: 'main', remote: '' }]))).toEqual({
			listBranches: ['main'],
			listRemoteBranches: [],
			listTags: [],
		});
	});
});

describe('commitStashName', () => {
	it('names the stash a stash commit stands for', () => {
		expect(commitStashName(commit([{ kind: 'stash', name: 'stash@{2}' }]))).toBe('stash@{2}');
	});

	it('names nothing for a commit that is not a stash', () => {
		expect(commitStashName(commit([{ kind: 'branch', name: 'main' }]))).toBeUndefined();
	});
});
