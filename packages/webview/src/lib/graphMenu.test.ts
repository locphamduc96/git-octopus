import { describe, expect, it } from 'vitest';
import type { Commit, Ref } from '@git-octopus/shared';
import {
	buildCommitMenuItems,
	buildDropMenuItems,
	buildHeaderMenuItems,
	buildMultiMenuItems,
	buildRefMenu,
	mapMultiAction,
	resolveMenuSelection,
} from './graphMenu';
import { buildChips } from './graphChips';
import type { RefChip } from './graphChips';

function commit(hash: string, refs: Ref[] = [], parents: string[] = ['p']): Commit {
	return {
		hash,
		parents,
		author: { name: 'a', email: 'a@x' },
		committedAt: 0,
		authoredAt: 0,
		subject: 's',
		refs,
	};
}

const ids = (list: { id: string }[]): string[] => list.map((item) => item.id);

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

const labels = (list: { label: string }[]): string[] => list.map((item) => item.label);

describe('buildCommitMenuItems', () => {
	it('shows only stash actions and the copies for a stash', () => {
		const items = buildCommitMenuItems(
			commit('h', [{ kind: 'stash', name: 'stash@{0}' }]),
			'main'
		).items;
		expect(ids(items)).toEqual([
			'stashApply',
			'stashPop',
			'stashBranch',
			'stashDrop',
			'copyHash',
			'copySubject',
		]);
	});

	it('offers the base actions for a plain commit, without branch or tag entries', () => {
		const items = buildCommitMenuItems(commit('h'), 'main').items;
		expect(ids(items)).toEqual([
			'checkout',
			'createBranch',
			'addTag',
			'merge',
			'rebase',
			'cherryPick',
			'revert',
			'reword',
			'reset',
			'openOnRemote',
			'copyRemoteUrl',
			'copyHash',
			'copySubject',
		]);
		expect(items.find((item) => item.id === 'reset')?.children?.map((child) => child.id)).toEqual([
			'resetSoft',
			'resetMixed',
			'resetHard',
		]);
	});

	it('names the current branch in merge/rebase/reset, or falls back to a phrase', () => {
		const named = buildCommitMenuItems(commit('h'), 'main').items;
		expect(named.find((item) => item.id === 'merge')?.label).toBe('Merge into main…');
		const detached = buildCommitMenuItems(commit('h'), null).items;
		expect(detached.find((item) => item.id === 'rebase')?.label).toBe(
			'Rebase the current branch on this Commit…'
		);
	});

	it('never offers a ref action that would have to ask which ref was meant', () => {
		const refs: Ref[] = [
			{ kind: 'branch', name: 'feature' },
			{ kind: 'branch', name: 'other' },
			{ kind: 'tag', name: 'v1' },
		];
		const items = buildCommitMenuItems(
			commit('h', refs),
			'main',
			buildChips(refs, 'main', null)
		).items;
		for (const ambiguous of [
			'deleteBranch',
			'deleteRemoteBranch',
			'checkoutRemote',
			'fetchIntoLocal',
			'pushTag',
			'deleteTag',
			'deleteRemoteTag',
		])
			expect(ids(items)).not.toContain(ambiguous);
	});

	it('gives every ref on the commit its own submenu, named after the chip', () => {
		const refs: Ref[] = [
			{ kind: 'branch', name: 'feature' },
			{ kind: 'branch', name: 'other', remote: 'origin' },
			{ kind: 'tag', name: 'v1' },
		];
		const menu = buildCommitMenuItems(commit('h', refs), 'main', buildChips(refs, 'main', null));
		const listSubmenus = menu.items.filter((item) => item.children && item.id !== 'reset');
		expect(labels(listSubmenus)).toEqual(['feature', 'origin/other', 'Tag v1']);
		// Each submenu's ids route back to its own chip, so no two share an id.
		const listIds = listSubmenus.flatMap((item) => item.children!.map((child) => child.id));
		expect(new Set(listIds).size).toBe(listIds.length);
		for (const id of listIds) expect(menu.mapEntries[id]).toBeDefined();
		expect(menu.mapEntries['branch:feature:deleteBranch'].target.chip.name).toBe('feature');
		expect(menu.mapEntries['branch:other:deleteRemoteBranch:origin'].target).toEqual({
			chip: expect.objectContaining({ name: 'other' }),
			remote: 'origin',
		});
	});

	it('keeps a branch and a tag of the same name apart', () => {
		const refs: Ref[] = [
			{ kind: 'branch', name: 'v1' },
			{ kind: 'tag', name: 'v1' },
		];
		const menu = buildCommitMenuItems(commit('h', refs), 'main', buildChips(refs, 'main', null));
		expect(menu.mapEntries['branch:v1:deleteBranch'].target.chip.kind).toBe('branch');
		expect(menu.mapEntries['tag:v1:deleteTag'].target.chip.kind).toBe('tag');
	});
});

describe('buildRefMenu', () => {
	it('names the branch in every label, so nothing downstream has to ask', () => {
		const menu = buildRefMenu(chip(), 'main');
		expect(labels(menu.items)).toEqual([
			'Checkout feature',
			'Merge feature into main…',
			'Rebase main onto feature…',
			'Delete feature…',
			'Copy Branch Name',
		]);
		expect(menu.mapEntries['branch:feature:deleteBranch'].run).toEqual({
			type: 'commit',
			action: 'deleteBranch',
		});
		expect(menu.mapEntries['branch:feature:mergeInto'].run).toEqual({
			type: 'branch',
			action: 'mergeInto',
			target: 'main',
		});
	});

	it('adds the remote half only when the chip has one', () => {
		const local = buildRefMenu(chip(), 'main');
		expect(ids(local.items)).not.toContain('branch:feature:fetchIntoLocal');
		const both = buildRefMenu(chip({ listRemotes: ['origin'] }), 'main');
		expect(labels(both.items)).toEqual(
			expect.arrayContaining([
				'Checkout origin/feature as local branch',
				'Fetch origin/feature into feature…',
				'Delete origin/feature…',
			])
		);
	});

	it('checks a remote-only chip out through the branch action that falls through to the remote', () => {
		const menu = buildRefMenu(chip({ hasLocal: false, listRemotes: ['origin'] }), 'main');
		expect(ids(menu.items)).toContain('branch:feature:checkoutBranch:origin');
		expect(ids(menu.items)).not.toContain('branch:feature:checkoutRemote:origin');
		expect(ids(menu.items)).not.toContain('branch:feature:deleteBranch');
	});

	it('disables delete on the checked-out branch and drops checkout/merge/rebase', () => {
		const menu = buildRefMenu(chip({ name: 'main', checkedOut: true }), 'main');
		expect(labels(menu.items)).toEqual(['Delete main…', 'Copy Branch Name']);
		expect(menu.items.find((item) => item.id === 'branch:main:deleteBranch')?.disabled).toBe(true);
		// A disabled entry must resolve to nothing, so no dispatch can be built from its id.
		expect(resolveMenuSelection(menu.items, 'branch:main:deleteBranch')).toBeNull();
	});

	it('gives every remote of one chip its own entries, each naming the remote it acts on', () => {
		const menu = buildRefMenu(chip({ listRemotes: ['origin', 'upstream'] }), 'main');
		expect(labels(menu.items)).toEqual([
			'Checkout feature',
			'Checkout origin/feature as local branch',
			'Checkout upstream/feature as local branch',
			'Fetch origin/feature into feature…',
			'Fetch upstream/feature into feature…',
			'Merge feature into main…',
			'Rebase main onto feature…',
			'Delete feature…',
			'Delete origin/feature…',
			'Delete upstream/feature…',
			'Copy Branch Name',
		]);
		expect(menu.mapEntries['branch:feature:deleteRemoteBranch:upstream'].target.remote).toBe(
			'upstream'
		);
		// The local delete is about the local ref, and must not drag a remote along with it.
		expect(menu.mapEntries['branch:feature:deleteBranch'].target.remote).toBeUndefined();
	});

	it('keeps an id pointing at the same ref when the chip order changes under it', () => {
		const alpha = chip({ name: 'alpha' });
		const beta = chip({ name: 'beta' });
		// `buildChips` reorders by which branch is checked out, so the menu is rebuilt in a new order
		// whenever HEAD moves. The ids must not follow that order.
		const before = buildCommitMenuItems(commit('h'), 'alpha', [alpha, beta]);
		const after = buildCommitMenuItems(commit('h'), 'beta', [beta, alpha]);
		expect(before.mapEntries['branch:beta:deleteBranch'].target.chip.name).toBe('beta');
		expect(after.mapEntries['branch:beta:deleteBranch'].target.chip.name).toBe('beta');
	});

	it('drops merge and rebase when HEAD is detached', () => {
		const menu = buildRefMenu(chip(), null);
		expect(ids(menu.items)).not.toContain('branch:feature:mergeInto');
		expect(ids(menu.items)).not.toContain('branch:feature:rebaseOnto');
	});

	it('offers tag and stash actions on their own kinds, and nothing for detached HEAD', () => {
		const tag = buildRefMenu(chip({ kind: 'tag', name: 'v1', hasLocal: false }), 'main');
		expect(labels(tag.items)).toEqual([
			'Push v1 to origin…',
			'Delete v1…',
			'Delete v1 from origin…',
			'Copy Tag Name',
		]);
		const stash = buildRefMenu(chip({ kind: 'stash', name: 'stash@{0}', hasLocal: false }), 'main');
		expect(ids(stash.items)).toEqual([
			'stash:stash@{0}:stashApply',
			'stash:stash@{0}:stashPop',
			'stash:stash@{0}:stashBranch',
			'stash:stash@{0}:stashDrop',
		]);
		const head = buildRefMenu(chip({ kind: 'head', name: 'HEAD', hasLocal: false }), null);
		expect(head.items).toEqual([]);
	});
});

describe('resolveMenuSelection', () => {
	const listItems = [
		{ id: 'a', label: 'A' },
		{ id: 'off', label: 'Off', disabled: true },
		{
			id: 'parent',
			label: 'Parent',
			children: [
				{ id: 'child', label: 'Child' },
				{ id: 'childOff', label: 'Child off', disabled: true },
			],
		},
	];

	it('resolves a live item, at either level', () => {
		expect(resolveMenuSelection(listItems, 'a')?.id).toBe('a');
		expect(resolveMenuSelection(listItems, 'child')?.id).toBe('child');
	});

	it('refuses disabled items at either level, and ids that name nothing selectable', () => {
		expect(resolveMenuSelection(listItems, 'off')).toBeNull();
		expect(resolveMenuSelection(listItems, 'childOff')).toBeNull();
		// A submenu's own row opens a flyout; selecting it is not an action.
		expect(resolveMenuSelection(listItems, 'parent')).toBeNull();
		expect(resolveMenuSelection(listItems, 'nope')).toBeNull();
	});
});

describe('buildMultiMenuItems', () => {
	const a = commit('a', [], ['b']);
	const b = commit('b', [], ['c']);
	const merge = commit('m', [], ['x', 'y']);

	it('enables everything for a contiguous merge-free chain', () => {
		const items = buildMultiMenuItems([a, b]);
		expect(ids(items)).toEqual([
			'squashSelected',
			'dropSelected',
			'cherryPickSelected',
			'revertSelected',
		]);
		expect(items.every((item) => !item.disabled)).toBe(true);
	});

	it('disables squash/drop and explains when the run is not a chain', () => {
		const gap = commit('a', [], ['zzz']);
		const items = buildMultiMenuItems([gap, b]);
		expect(items.find((item) => item.id === 'squashSelected')?.disabled).toBe(true);
		expect(items.find((item) => item.id === 'multiHint')?.label).toBe(
			'Squash/Drop need a consecutive run on one branch'
		);
	});

	it('disables cherry-pick/revert too when the selection holds a merge', () => {
		const items = buildMultiMenuItems([merge, b]);
		expect(items.find((item) => item.id === 'cherryPickSelected')?.disabled).toBe(true);
		expect(items.find((item) => item.id === 'multiHint')?.label).toBe(
			'Selection contains merge commits'
		);
	});
});

describe('buildDropMenuItems', () => {
	const drop = { sourceLabel: 'origin/x', target: 'main' };

	it('offers merge and rebase, naming source and target', () => {
		expect(ids(buildDropMenuItems(drop, null, 1))).toEqual(['mergeInto', 'rebaseOnto']);
	});

	it('adds fast-forward only for a matching, positive answer', () => {
		expect(ids(buildDropMenuItems(drop, { nonce: 1, canFastForward: true }, 1))).toContain(
			'fastForward'
		);
		// A stale answer (another drop's nonce) or a negative one adds nothing.
		expect(ids(buildDropMenuItems(drop, { nonce: 2, canFastForward: true }, 1))).toEqual([
			'mergeInto',
			'rebaseOnto',
		]);
		expect(ids(buildDropMenuItems(drop, { nonce: 1, canFastForward: false }, 1))).toEqual([
			'mergeInto',
			'rebaseOnto',
		]);
	});

	it('is empty without an open drop', () => {
		expect(buildDropMenuItems(null, null, 0)).toEqual([]);
	});
});

describe('header menu and multi-action map', () => {
	it('mirrors column visibility into checkmarks', () => {
		const items = buildHeaderMenuItems({ author: true, commit: false, date: true });
		expect(items).toEqual([
			{ id: 'author', label: 'Author', checked: true },
			{ id: 'commit', label: 'Commit', checked: false },
			{ id: 'date', label: 'Date', checked: true },
		]);
	});

	it('maps every multi menu id to its action', () => {
		expect(mapMultiAction).toEqual({
			squashSelected: 'squash',
			dropSelected: 'drop',
			cherryPickSelected: 'cherryPick',
			revertSelected: 'revert',
		});
	});
});
