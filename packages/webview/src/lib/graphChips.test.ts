import { describe, expect, it } from 'vitest';
import type { Ref } from '@git-octopus/shared';
import { buildChips, chipRef, chipRemote, isDropTarget, splitChips } from './graphChips';

const local = (name: string): Ref => ({ kind: 'branch', name });
const remote = (name: string, from: string): Ref => ({ kind: 'branch', name, remote: from });

describe('buildChips', () => {
	it('merges a branch that exists locally and on remotes into one chip', () => {
		const listChips = buildChips([local('main'), remote('main', 'origin')], null, null);
		expect(listChips).toHaveLength(1);
		expect(listChips[0]).toMatchObject({ name: 'main', hasLocal: true, listRemotes: ['origin'] });
	});

	it('keeps one chip per remote name in the merged chip', () => {
		const [chip] = buildChips(
			[local('main'), remote('main', 'origin'), remote('main', 'upstream')],
			null,
			null
		);
		expect(chip.listRemotes).toEqual(['origin', 'upstream']);
	});

	it('drops the standalone HEAD ref, which the tick on the branch already says', () => {
		const listChips = buildChips([{ kind: 'head' }, local('main')], 'main', null);
		expect(listChips).toHaveLength(1);
		expect(listChips[0].checkedOut).toBe(true);
	});

	it('gives detached HEAD a chip of its own, since no branch carries the tick', () => {
		const listChips = buildChips([{ kind: 'head' }, local('main')], null, null);
		expect(listChips.map((chip) => chip.kind)).toEqual(['head', 'branch']);
		expect(listChips[0]).toMatchObject({ name: 'HEAD', checkedOut: false });
	});

	it('leads with the HEAD chip while detached', () => {
		// It is the one thing on the row a reader is hunting for; a tag ahead of it buries it.
		const listChips = buildChips(
			[{ kind: 'tag', name: 'v1' }, { kind: 'stash', name: 'stash@{0}' }, { kind: 'head' }],
			null,
			null
		);
		expect(listChips[0].kind).toBe('head');
	});

	it('marks a branch checked out only when it is the local one', () => {
		// A remote-tracking ref of the checked-out name is not what HEAD points at.
		const [chip] = buildChips([remote('main', 'origin')], 'main', null);
		expect(chip.checkedOut).toBe(false);
	});

	it('orders stash first, then branches, then tags', () => {
		const listChips = buildChips(
			[{ kind: 'tag', name: 'v1' }, local('dev'), { kind: 'stash', name: 'stash@{0}' }],
			null,
			null
		);
		expect(listChips.map((chip) => chip.kind)).toEqual(['stash', 'branch', 'tag']);
	});

	it('ranks checked out, then last picked, then local, then remote-only', () => {
		const listChips = buildChips(
			[remote('remote-only', 'origin'), local('other'), local('picked'), local('current')],
			'current',
			'picked'
		);
		expect(listChips.map((chip) => chip.name)).toEqual([
			'current',
			'picked',
			'other',
			'remote-only',
		]);
	});

	it('describes what a chip stands for in its tooltip', () => {
		const [chip] = buildChips([local('main'), remote('main', 'origin')], 'main', null);
		expect(chip.title).toBe('main — checked out, origin/main');
	});

	it('says "local branch" when the branch is not the checked-out one', () => {
		const [chip] = buildChips([local('dev')], 'main', null);
		expect(chip.title).toBe('dev — local branch');
	});
});

describe('splitChips', () => {
	it('keeps the first branch chip visible and folds the rest away', () => {
		const listChips = buildChips([local('a'), local('b'), local('c')], null, null);
		const groups = splitChips(listChips);
		expect(groups.listVisible.map((chip) => chip.name)).toEqual(['a']);
		expect(groups.listOverflow.map((chip) => chip.name)).toEqual(['b', 'c']);
	});

	it('never folds tags or stashes, which have no `+N` of their own', () => {
		const listChips = buildChips(
			[local('a'), local('b'), { kind: 'tag', name: 'v1' }, { kind: 'stash', name: 's' }],
			null,
			null
		);
		const groups = splitChips(listChips);
		expect(groups.listVisible.map((chip) => chip.kind)).toEqual(['stash', 'branch', 'tag']);
		expect(groups.listOverflow.map((chip) => chip.name)).toEqual(['b']);
	});

	it('folds nothing when a commit carries a single branch', () => {
		expect(splitChips(buildChips([local('a')], null, null)).listOverflow).toEqual([]);
	});
});

describe('chipRef / chipRemote', () => {
	it('hands git the bare name for a local branch', () => {
		const [chip] = buildChips([local('main'), remote('main', 'origin')], null, null);
		expect(chipRef(chip)).toEqual({ ref: 'main', label: 'main' });
	});

	it('hands git the full ref path for a remote-only branch, and the short label to read', () => {
		const [chip] = buildChips([remote('main', 'origin')], null, null);
		expect(chipRemote(chip)).toEqual({ remote: 'origin', branch: 'main' });
		expect(chipRef(chip)).toEqual({ ref: 'refs/remotes/origin/main', label: 'origin/main' });
	});

	it('answers null for a chip that stands for no branch ref', () => {
		const [chip] = buildChips([{ kind: 'tag', name: 'v1' }], null, null);
		expect(chipRemote(chip)).toBeNull();
		expect(chipRef(chip)).toBeNull();
	});
});

describe('isDropTarget', () => {
	const [localChip] = buildChips([local('main')], null, null);
	const [remoteChip] = buildChips([remote('main', 'origin')], null, null);
	const [tagChip] = buildChips([{ kind: 'tag', name: 'v1' }], null, null);

	it('accepts only a local branch other than the one being dragged', () => {
		expect(isDropTarget(localChip, 'feature')).toBe(true);
		expect(isDropTarget(localChip, 'main')).toBe(false);
	});

	it('refuses while nothing is dragged, and refuses non-writable refs', () => {
		expect(isDropTarget(localChip, null)).toBe(false);
		expect(isDropTarget(remoteChip, 'feature')).toBe(false);
		expect(isDropTarget(tagChip, 'feature')).toBe(false);
	});
});
