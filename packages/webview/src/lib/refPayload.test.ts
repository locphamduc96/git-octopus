import { describe, expect, it } from 'vitest';
import { buildRefPayload } from './refPayload';
import type { RefChip } from './graphChips';

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
