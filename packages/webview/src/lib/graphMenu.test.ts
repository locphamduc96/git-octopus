import { describe, expect, it } from 'vitest';
import type { Commit, Ref, UpstreamTracking } from '@git-octopus/shared';
import {
	buildCommitMenuItems,
	buildDropMenuItems,
	buildHeaderMenuItems,
	buildMultiMenuItems,
	buildRefMenu,
	resolveMenuSelection,
	type MenuEntry,
	type RefTarget,
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

const track = (over: Partial<UpstreamTracking> = {}): UpstreamTracking => ({
	upstream: 'origin/feature',
	ahead: 0,
	behind: 0,
	gone: false,
	...over,
});

/** The label of the plain `Checkout <name>` entry in a chip's own menu. */
function checkoutLabel(tracking: UpstreamTracking | null): string {
	const menu = buildRefMenu(chip({ tracking }), 'main');
	const entry = menu.items.find((item) => item.id.endsWith(':checkoutBranch'));
	return entry?.label ?? '';
}

function chip(over: Partial<RefChip> = {}): RefChip {
	return {
		kind: 'branch',
		name: 'feature',
		checkedOut: false,
		hasLocal: true,
		listRemotes: [],
		title: '',
		tracking: null,
		...over,
	};
}

const labels = (list: { label: string }[]): string[] => list.map((item) => item.label);

/** The ref an entry acts on; only the entries built from a ref menu carry one. */
const targetOf = (entry: MenuEntry | undefined): RefTarget | undefined =>
	entry && 'target' in entry && entry.type !== 'explain' ? entry.target : undefined;

describe('explain entries', () => {
	it('explains the commit the menu was opened on', () => {
		const menu = buildCommitMenuItems(commit('abc123'), 'main');
		expect(menu.mapEntries.explainCommit).toEqual({
			type: 'explain',
			target: { kind: 'commit', hash: 'abc123' },
		});
	});

	it('explains a branch by its full ref, local first, else its remote', () => {
		const local = buildRefMenu(chip(), 'main').mapEntries['branch:feature:explainRef'];
		expect(local).toEqual({
			type: 'explain',
			target: { kind: 'branch', ref: 'refs/heads/feature', label: 'feature' },
		});
		const remoteOnly = buildRefMenu(chip({ hasLocal: false, listRemotes: ['origin'] }), 'main')
			.mapEntries['branch:feature:explainRef'];
		expect(remoteOnly).toEqual({
			type: 'explain',
			target: { kind: 'branch', ref: 'refs/remotes/origin/feature', label: 'origin/feature' },
		});
	});
});

describe('worktree entries', () => {
	it('offers to create a worktree for a branch checked out nowhere', () => {
		const menu = buildRefMenu(chip(), 'main');
		expect(menu.mapEntries['branch:feature:createWorktree']).toEqual({
			type: 'worktree',
			op: 'add',
			branch: 'feature',
		});
	});

	it('opens the worktree that holds a branch instead of checking it out', () => {
		const menu = buildRefMenu(chip(), 'main', {
			pinnedRef: null,
			listSolo: [],
			mapWorktrees: { feature: '/code/app-feature' },
		});
		expect(labels(menu.items)).toContain('Open Worktree for feature in New Window');
		expect(labels(menu.items)).not.toContain('Checkout feature');
		expect(labels(menu.items)).not.toContain('Create Worktree for feature…');
		expect(menu.mapEntries['branch:feature:openWorktree']).toEqual({
			type: 'worktree',
			op: 'open',
			path: '/code/app-feature',
		});
	});

	it('offers neither on the checked-out branch', () => {
		const menu = buildRefMenu(chip({ checkedOut: true }), 'feature');
		expect(labels(menu.items).some((label) => label.includes('Worktree'))).toBe(false);
	});
});

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
			'compareWorking',
			'explainCommit',
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
		expect(targetOf(menu.mapEntries['branch:feature:deleteBranch'])?.chip.name).toBe('feature');
		expect(targetOf(menu.mapEntries['branch:other:deleteRemoteBranch:origin'])).toEqual({
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
		expect(targetOf(menu.mapEntries['branch:v1:deleteBranch'])?.chip.kind).toBe('branch');
		expect(targetOf(menu.mapEntries['tag:v1:deleteTag'])?.chip.kind).toBe('tag');
	});

	it('runs its own entries under the commit protocol, and the submenu parents not at all', () => {
		const refs: Ref[] = [{ kind: 'branch', name: 'feature' }];
		const menu = buildCommitMenuItems(commit('h', refs), 'main', buildChips(refs, 'main', null));
		expect(menu.mapEntries['checkout']).toEqual({ type: 'commit', action: 'checkout' });
		expect(menu.mapEntries['resetHard']).toEqual({ type: 'commit', action: 'resetHard' });
		expect(menu.mapEntries['copySubject']).toEqual({ type: 'commit', action: 'copySubject' });
		// Both parents open a flyout rather than firing, so neither names an action.
		expect(menu.mapEntries['reset']).toBeUndefined();
		expect(menu.mapEntries['branch:feature']).toBeUndefined();
	});

	it('gives the stash menu entries of its own', () => {
		const menu = buildCommitMenuItems(commit('h', [{ kind: 'stash', name: 'stash@{0}' }]), 'main');
		expect(menu.mapEntries['stashPop']).toEqual({ type: 'commit', action: 'stashPop' });
		expect(menu.mapEntries['copyHash']).toEqual({ type: 'commit', action: 'copyHash' });
	});

	// The invariant the dispatcher rests on: it looks an id up and runs what it finds, so an id it
	// can reach with nothing behind it would be a menu row that silently does nothing.
	it('leaves no selectable id without an entry', () => {
		const refs: Ref[] = [
			{ kind: 'branch', name: 'feature', remote: 'origin' },
			{ kind: 'branch', name: 'feature' },
			{ kind: 'tag', name: 'v1' },
		];
		const menu = buildCommitMenuItems(commit('h', refs), 'main', buildChips(refs, 'main', null));
		for (const item of menu.items) {
			const listSelectable = item.children ?? [item];
			for (const selectable of listSelectable)
				expect(menu.mapEntries[selectable.id], selectable.id).toBeDefined();
		}
	});
});

describe('buildRefMenu', () => {
	it('names the branch in every label, so nothing downstream has to ask', () => {
		const menu = buildRefMenu(chip(), 'main');
		expect(labels(menu.items)).toEqual([
			'Checkout feature',
			'Create Worktree for feature…',
			'Show Only feature',
			'Hide feature',
			'Pin feature to Left',
			'Explain feature with AI',
			'Merge feature into main…',
			'Rebase main onto feature…',
			'Rename feature…',
			'Set Upstream of feature…',
			'Delete feature…',
			'Copy Branch Name',
		]);
		expect(menu.mapEntries['branch:feature:deleteBranch']).toMatchObject({
			type: 'commit',
			action: 'deleteBranch',
		});
		expect(menu.mapEntries['branch:feature:mergeInto']).toMatchObject({
			type: 'branch',
			action: 'mergeInto',
			onto: 'main',
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

	it('filters by the local name, and by the remote ref when no local branch exists', () => {
		const local = buildRefMenu(chip(), 'main');
		expect(local.mapEntries['branch:feature:filterBranch']).toEqual({
			type: 'filter',
			ref: 'feature',
		});
		// Remote-only: git has to be handed a ref that exists, and `feature` alone is not one.
		const remoteOnly = buildRefMenu(chip({ hasLocal: false, listRemotes: ['origin'] }), 'main');
		expect(remoteOnly.mapEntries['branch:feature:filterBranch']).toEqual({
			type: 'filter',
			ref: 'origin/feature',
		});
	});

	it('renames only through the local ref, prefilled by the entry that names it', () => {
		const menu = buildRefMenu(chip(), 'main');
		expect(menu.mapEntries['branch:feature:renameBranch']).toMatchObject({
			type: 'commit',
			action: 'renameBranch',
		});
		const remoteOnly = buildRefMenu(chip({ hasLocal: false, listRemotes: ['origin'] }), 'main');
		expect(ids(remoteOnly.items)).not.toContain('branch:feature:renameBranch');
	});

	it('disables delete on the checked-out branch and drops checkout/merge/rebase', () => {
		const menu = buildRefMenu(chip({ name: 'main', checkedOut: true }), 'main');
		expect(labels(menu.items)).toEqual([
			'Show Only main',
			'Show Only Related Branches',
			'Pin main to Left',
			'Explain main with AI',
			'Rename main…',
			'Set Upstream of main…',
			'Delete main…',
			'Copy Branch Name',
		]);
		expect(menu.items.find((item) => item.id === 'branch:main:deleteBranch')?.disabled).toBe(true);
		// A disabled entry must resolve to nothing, so no dispatch can be built from its id.
		expect(resolveMenuSelection(menu.items, 'branch:main:deleteBranch')).toBeNull();
	});

	it('gives every remote of one chip its own entries, each naming the remote it acts on', () => {
		const menu = buildRefMenu(chip({ listRemotes: ['origin', 'upstream'] }), 'main');
		expect(labels(menu.items)).toEqual([
			'Checkout feature',
			'Create Worktree for feature…',
			'Checkout origin/feature as local branch',
			'Checkout upstream/feature as local branch',
			'Fetch origin/feature into feature…',
			'Fetch upstream/feature into feature…',
			'Push feature to origin',
			'Push feature to upstream',
			'Show Only feature',
			'Hide feature',
			'Pin feature to Left',
			'Explain feature with AI',
			'Merge feature into main…',
			'Rebase main onto feature…',
			'Rename feature…',
			'Set Upstream of feature…',
			'Delete feature…',
			'Delete origin/feature…',
			'Delete upstream/feature…',
			'Copy Branch Name',
		]);
		expect(targetOf(menu.mapEntries['branch:feature:deleteRemoteBranch:upstream'])?.remote).toBe(
			'upstream'
		);
		// The local delete is about the local ref, and must not drag a remote along with it. Asserted
		// on the whole target rather than on `remote` alone: `undefined?.remote` is undefined too, so
		// the narrower check would keep passing if the entry vanished.
		expect(targetOf(menu.mapEntries['branch:feature:deleteBranch'])).toEqual({
			chip: expect.objectContaining({ name: 'feature' }),
		});
	});

	it('keeps an id pointing at the same ref when the chip order changes under it', () => {
		const alpha = chip({ name: 'alpha' });
		const beta = chip({ name: 'beta' });
		// `buildChips` reorders by which branch is checked out, so the menu is rebuilt in a new order
		// whenever HEAD moves. The ids must not follow that order.
		const before = buildCommitMenuItems(commit('h'), 'alpha', [alpha, beta]);
		const after = buildCommitMenuItems(commit('h'), 'beta', [beta, alpha]);
		expect(targetOf(before.mapEntries['branch:beta:deleteBranch'])?.chip.name).toBe('beta');
		expect(targetOf(after.mapEntries['branch:beta:deleteBranch'])?.chip.name).toBe('beta');
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
			'Hide v1',
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

	it('enables everything for a contiguous merge-free chain at the tip', () => {
		const menu = buildMultiMenuItems([a, b], a.hash);
		expect(ids(menu.items)).toEqual([
			'squashSelected',
			'dropSelected',
			'cherryPickSelected',
			'revertSelected',
			'rebaseRangeSelected',
		]);
		expect(menu.items.every((item) => !item.disabled)).toBe(true);
	});

	it('disables squash/drop and explains when the run is not a chain', () => {
		const gap = commit('a', [], ['zzz']);
		const menu = buildMultiMenuItems([gap, b]);
		expect(menu.items.find((item) => item.id === 'squashSelected')?.disabled).toBe(true);
		expect(menu.items.find((item) => item.id === 'multiHint')?.label).toBe(
			'Squash/Drop need a consecutive run on one branch'
		);
	});

	it('disables cherry-pick/revert too when the selection holds a merge', () => {
		const menu = buildMultiMenuItems([merge, b]);
		expect(menu.items.find((item) => item.id === 'cherryPickSelected')?.disabled).toBe(true);
		expect(menu.items.find((item) => item.id === 'multiHint')?.label).toBe(
			'Selection contains merge commits'
		);
	});

	it('gives every selectable entry the action it runs, and the hint none', () => {
		const menu = buildMultiMenuItems([a, b]);
		expect(menu.mapEntries).toEqual({
			squashSelected: { type: 'multi', action: 'squash' },
			dropSelected: { type: 'multi', action: 'drop' },
			cherryPickSelected: { type: 'multi', action: 'cherryPick' },
			revertSelected: { type: 'multi', action: 'revert' },
			rebaseRangeSelected: { type: 'multi', action: 'rebaseRange' },
		});
		expect(buildMultiMenuItems([merge, b]).mapEntries['multiHint']).toBeUndefined();
	});

	// The entry survives so that `resolveMenuSelection` stays the single place an action is ruled
	// out; a map with holes in it would answer the same question a second time, and could disagree.
	it('keeps the entry of a disabled action', () => {
		const menu = buildMultiMenuItems([merge, b]);
		expect(menu.items.find((item) => item.id === 'revertSelected')?.disabled).toBe(true);
		expect(menu.mapEntries['revertSelected']).toEqual({ type: 'multi', action: 'revert' });
		expect(resolveMenuSelection(menu.items, 'revertSelected')).toBeNull();
	});
});

describe('buildDropMenuItems', () => {
	const drop = {
		sourceLabel: 'origin/x',
		sourceLocal: false,
		target: 'main',
		targetLocal: true,
		listTargetRemotes: [],
	};

	it('offers merge, rebase and reset onto a local branch, naming source and target', () => {
		expect(ids(buildDropMenuItems(drop, null, 1))).toEqual(['mergeInto', 'rebaseOnto', 'resetTo']);
		expect(labels(buildDropMenuItems(drop, null, 1))).toContain('Reset main to origin/x…');
	});

	it('adds fast-forward only for a matching, positive answer', () => {
		expect(ids(buildDropMenuItems(drop, { nonce: 1, canFastForward: true }, 1))).toContain(
			'fastForward'
		);
		// A stale answer (another drop's nonce) or a negative one adds nothing.
		expect(ids(buildDropMenuItems(drop, { nonce: 2, canFastForward: true }, 1))).not.toContain(
			'fastForward'
		);
		expect(ids(buildDropMenuItems(drop, { nonce: 1, canFastForward: false }, 1))).not.toContain(
			'fastForward'
		);
	});

	it('offers a push to each remote of the target, from a local branch only', () => {
		const fromLocal = {
			...drop,
			sourceLabel: 'feature',
			sourceLocal: true,
			listTargetRemotes: ['origin', 'up'],
		};
		expect(ids(buildDropMenuItems(fromLocal, null, 1))).toEqual([
			'mergeInto',
			'rebaseOnto',
			'interactiveRebase',
			'resetTo',
			'pushTo:origin',
			'pushTo:up',
		]);
		expect(
			ids(buildDropMenuItems({ ...drop, listTargetRemotes: ['origin'] }, null, 1))
		).not.toContain('pushTo:origin');
	});

	it('offers only rebase and push onto a branch that exists only on a remote', () => {
		const onRemote = {
			sourceLabel: 'feature',
			sourceLocal: true,
			target: 'release',
			targetLocal: false,
			listTargetRemotes: ['origin'],
		};
		expect(ids(buildDropMenuItems(onRemote, null, 1))).toEqual([
			'rebaseOnto:origin',
			'interactiveRebase:origin',
			'pushTo:origin',
		]);
	});

	it('offers an interactive rebase only for a local branch, which has commits to rewrite', () => {
		// `drop` drags origin/x: a remote copy is not ours to rewrite.
		expect(ids(buildDropMenuItems(drop, null, 1))).not.toContain('interactiveRebase');
		const fromLocal = { ...drop, sourceLabel: 'feature', sourceLocal: true };
		expect(labels(buildDropMenuItems(fromLocal, null, 1))).toContain(
			'Interactive Rebase feature onto main…'
		);
	});

	it('is empty without an open drop', () => {
		expect(buildDropMenuItems(null, null, 0)).toEqual([]);
	});
});

describe('buildHeaderMenuItems', () => {
	it('mirrors column visibility into checkmarks', () => {
		const items = buildHeaderMenuItems({ author: true, commit: false, date: true, changes: false });
		expect(items).toEqual([
			{ id: 'author', label: 'Author', checked: true },
			{ id: 'commit', label: 'Commit', checked: false },
			{ id: 'date', label: 'Date', checked: true },
			{ id: 'changes', label: 'Changes', checked: false },
		]);
	});
});

describe('the checkout entry names the gap it is walking into', () => {
	it('says nothing extra for a branch level with its upstream', () => {
		expect(checkoutLabel(track())).toBe('Checkout feature');
	});

	it('says nothing extra for a branch with no upstream at all', () => {
		expect(checkoutLabel(null)).toBe('Checkout feature');
	});

	it('names how far behind the branch is', () => {
		expect(checkoutLabel(track({ behind: 12 }))).toBe('Checkout feature — 12 behind');
	});

	it('calls out a diverged branch, where the fast-forward will be refused', () => {
		expect(checkoutLabel(track({ ahead: 3, behind: 12 }))).toBe(
			'Checkout feature — 12 behind, diverged'
		);
	});

	it('says some when the count could not be read', () => {
		expect(checkoutLabel(track({ behind: null }))).toBe('Checkout feature — some behind');
	});

	// Being ahead changes nothing about checking a branch out.
	it('stays quiet about a branch that is only ahead', () => {
		expect(checkoutLabel(track({ ahead: 3 }))).toBe('Checkout feature');
	});

	it('stays quiet when the upstream is gone — there is nothing to catch up to', () => {
		expect(checkoutLabel(track({ behind: 4, gone: true }))).toBe('Checkout feature');
	});
});

describe('the push entry', () => {
	const pushLabels = (over: Partial<RefChip>): string[] =>
		buildRefMenu(chip({ listRemotes: ['origin'], ...over }), 'main')
			.items.filter((item) => item.id.includes(':pushBranch:'))
			.map((item) => item.label);

	it('offers one entry per remote, naming the branch and the remote', () => {
		expect(pushLabels({ listRemotes: ['origin', 'upstream'], tracking: null })).toEqual([
			'Push feature to origin',
			'Push feature to upstream',
		]);
	});

	it('names how much is waiting to be sent', () => {
		expect(pushLabels({ tracking: track({ ahead: 3 }) })).toEqual([
			'Push feature to origin — 3 ahead',
		]);
	});

	// Being behind changes nothing about pushing.
	it('stays quiet about a branch that is only behind', () => {
		expect(pushLabels({ tracking: track({ behind: 9 }) })).toEqual(['Push feature to origin']);
	});

	it('is absent for a chip that stands only for a remote branch', () => {
		expect(pushLabels({ hasLocal: false, tracking: null })).toEqual([]);
	});

	it('is absent for a local branch with no remote to push to', () => {
		expect(pushLabels({ listRemotes: [], tracking: null })).toEqual([]);
	});
});

describe('the range-rebase entry', () => {
	const A = 'a'.repeat(40);
	const B = 'b'.repeat(40);
	const C = 'c'.repeat(40);
	/** Newest → oldest, a contiguous first-parent run. */
	const chainOf = (...listHashes: string[]): Commit[] =>
		listHashes.map((hash, index) => commit(hash, [], [listHashes[index + 1] ?? 'z'.repeat(40)]));

	const entry = (listCommits: Commit[], headHash: string | null) =>
		buildMultiMenuItems(listCommits, headHash).items.find(
			(item) => item.id === 'rebaseRangeSelected'
		);

	it('is offered on a run that reaches the tip', () => {
		const item = entry(chainOf(A, B, C), A);
		expect(item?.label).toBe('Rebase 3 Commits onto…');
		expect(item?.disabled).toBe(false);
	});

	// The command replays to the tip whatever was selected, so stopping short would move more
	// commits than the label names.
	it('is disabled when the newest selected commit is not the tip', () => {
		expect(entry(chainOf(A, B, C), 'd'.repeat(40))?.disabled).toBe(true);
	});

	it('is disabled when HEAD is not known', () => {
		expect(entry(chainOf(A, B, C), null)?.disabled).toBe(true);
	});

	it('is disabled on a selection that is not a contiguous run', () => {
		const listBroken = [commit(A, [], ['x'.repeat(40)]), commit(C, [], ['y'.repeat(40)])];
		expect(entry(listBroken, A)?.disabled).toBe(true);
	});

	it('explains why, when the only thing wrong is not reaching the tip', () => {
		const listItems = buildMultiMenuItems(chainOf(A, B, C), 'd'.repeat(40)).items;
		expect(listItems.some((item) => item.label.includes('reach the branch tip'))).toBe(true);
	});
});

describe('buildRefMenu view entries', () => {
	it('hides a local branch together with its remotes', () => {
		const menu = buildRefMenu(chip({ listRemotes: ['origin'] }), 'main');
		expect(menu.mapEntries['branch:feature:hideRef']).toEqual({
			type: 'hide',
			refs: { listBranches: ['feature'], listRemotes: ['origin/feature'], listTags: [] },
		});
	});

	it('offers to add a branch to an active Show Only set, and to take a member out', () => {
		const outside = buildRefMenu(chip(), 'main', { pinnedRef: null, listSolo: ['main'] });
		expect(labels(outside.items)).toContain('Also Show feature');
		const inside = buildRefMenu(chip(), 'main', { pinnedRef: null, listSolo: ['main', 'feature'] });
		expect(labels(inside.items)).toContain('Stop Showing feature');
		const only = buildRefMenu(chip(), 'main', { pinnedRef: null, listSolo: ['feature'] });
		expect(labels(only.items)).not.toContain('Stop Showing feature');
	});

	it('turns Pin into Unpin for the pinned branch', () => {
		const menu = buildRefMenu(chip(), 'main', { pinnedRef: 'feature', listSolo: [] });
		expect(labels(menu.items)).toContain('Unpin feature from Left');
		expect(menu.mapEntries['branch:feature:pinLeft']).toEqual({ type: 'pin', ref: null });
	});
});

describe('buildRefMenu upstream entries', () => {
	it('offers Unset Upstream only on a branch that has one', () => {
		const tracked = buildRefMenu(
			chip({ tracking: { upstream: 'origin/feature', ahead: 0, behind: 0, gone: false } }),
			'main'
		);
		expect(labels(tracked.items)).toContain('Unset Upstream of feature');
		expect(labels(buildRefMenu(chip(), 'main').items)).not.toContain('Unset Upstream of feature');
	});
});

describe('buildCommitMenuItems interactive rebase', () => {
	it('offers the editor only on a commit below HEAD on its own line', () => {
		const below = buildCommitMenuItems(commit('h'), 'main', [], {
			pinnedRef: null,
			listSolo: [],
			rebaseFromHere: true,
		});
		expect(ids(below.items)).toContain('interactiveRebase');
		expect(ids(buildCommitMenuItems(commit('h'), 'main').items)).not.toContain('interactiveRebase');
	});
});
