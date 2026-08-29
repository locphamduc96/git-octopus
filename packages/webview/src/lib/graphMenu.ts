import type { BranchActionId, Commit, CommitActionId } from '@git-octopus/shared';
import { remoteRefLabel } from '@git-octopus/shared';
import type { RefChip } from './graphChips';
import { isSquashableChain } from './squashRange';
import type { MenuItem } from './ui/ContextMenu.svelte';
import type { ColumnVisibility } from './viewSettings';

/** The header's right-click menu: one checkable entry per optional column. */
export function buildHeaderMenuItems(columns: ColumnVisibility): MenuItem[] {
	return [
		{ id: 'author', label: 'Author', checked: columns.author },
		{ id: 'commit', label: 'Commit', checked: columns.commit },
		{ id: 'date', label: 'Date', checked: columns.date },
	];
}

/**
 * The menu for one branch chip dropped onto another. The fast-forward entry only appears when
 * the host has answered *this* drop's question — `fastForward` is matched against the nonce the
 * question was asked with, so a stale answer from an abandoned drag offers nothing.
 */
export function buildDropMenuItems(
	drop: { sourceLabel: string; target: string } | null,
	fastForward: { nonce: number; canFastForward: boolean } | null,
	ffNonce: number
): MenuItem[] {
	if (!drop) return [];
	const items: MenuItem[] = [
		{ id: 'mergeInto', label: `Merge ${drop.sourceLabel} into ${drop.target}…` },
		{ id: 'rebaseOnto', label: `Rebase ${drop.sourceLabel} onto ${drop.target}…` },
	];
	if (fastForward?.nonce === ffNonce && fastForward.canFastForward) {
		items.push({
			id: 'fastForward',
			label: `Fast-forward ${drop.target} to ${drop.sourceLabel}`,
		});
	}
	return items;
}

/** The context menu over a multi-selected run of commits (newest → oldest). */
export function buildMultiMenuItems(listSelectedCommits: Commit[]): MenuItem[] {
	const n = listSelectedCommits.length;
	const chain = isSquashableChain(listSelectedCommits);
	// Cherry-pick and revert replay commits one by one, so they only need merge-free picks,
	// not a contiguous chain.
	const noMerges = listSelectedCommits.every((commit) => commit.parents.length === 1);
	const items: MenuItem[] = [
		{ id: 'squashSelected', label: `Squash ${n} Commits…`, disabled: !chain },
		{ id: 'dropSelected', label: `Drop ${n} Commits…`, disabled: !chain },
		{
			id: 'cherryPickSelected',
			label: `Cherry Pick ${n} Commits…`,
			disabled: !noMerges,
			separatorBefore: true,
		},
		{ id: 'revertSelected', label: `Revert ${n} Commits…`, disabled: !noMerges },
	];
	if (!chain) {
		items.push({
			id: 'multiHint',
			label: noMerges
				? 'Squash/Drop need a consecutive run on one branch'
				: 'Selection contains merge commits',
			disabled: true,
			separatorBefore: true,
		});
	}
	return items;
}

/**
 * What one entry of a ref menu runs. `commit` entries reuse the commit-action protocol with a
 * payload narrowed to this one ref; `branch` entries go through the branch-action protocol the
 * drag gesture already uses, where source and target are both named outright.
 */
export type RefMenuRun =
	| { type: 'commit'; action: CommitActionId }
	| { type: 'branch'; action: BranchActionId; target: string }
	// Handled inside the webview: the graph reloads with `ref` as its only walk root. The ref is
	// resolved here, at build time, so the entry itself says what `git log` will be handed.
	| { type: 'filter'; ref: string };

/**
 * The exact ref an action runs on. A chip may stand for a local branch and the same branch on
 * several remotes at once, so naming the chip is not enough: `remote` picks out which of them the
 * entry meant, and an entry without it is about the local ref.
 */
export interface RefTarget {
	chip: RefChip;
	remote?: string;
}

export interface RefMenuEntry {
	target: RefTarget;
	run: RefMenuRun;
}

export interface RefMenu {
	items: MenuItem[];
	/** Menu-item id -> what it runs and which ref it runs on. */
	mapEntries: Record<string, RefMenuEntry>;
}

/**
 * A chip's identity inside one commit's menus.
 *
 * Deliberately not the chip's index. The chip list is rebuilt whenever `currentBranch` or the last
 * picked branch changes, and its order changes with them — an index-keyed id would survive that
 * rebuild pointing at a different ref, so a click aimed at one branch could delete another. Kind
 * and name cannot collide: `git check-ref-format` forbids `:` in a ref name, branches are already
 * merged by name into one chip, and a branch and a tag of the same name differ in kind.
 */
function refKey(chip: RefChip): string {
	return `${chip.kind}:${chip.name}`;
}

/**
 * The menu for one ref chip. Every entry names its ref in the label — including which remote, when
 * the chip carries more than one — because the whole point of a ref-scoped menu is that nothing
 * downstream has to ask which ref was meant.
 */
export function buildRefMenu(chip: RefChip, currentBranch: string | null): RefMenu {
	const items: MenuItem[] = [];
	const mapEntries: Record<string, RefMenuEntry> = {};
	const prefix = refKey(chip);

	const add = (
		action: string,
		label: string,
		run: RefMenuRun,
		extra?: { separatorBefore?: boolean; disabled?: boolean; remote?: string }
	): void => {
		const id = extra?.remote ? `${prefix}:${action}:${extra.remote}` : `${prefix}:${action}`;
		items.push({ id, label, separatorBefore: extra?.separatorBefore, disabled: extra?.disabled });
		mapEntries[id] = { target: { chip, remote: extra?.remote }, run };
	};

	if (chip.kind === 'stash') {
		add('stashApply', `Apply ${chip.name}…`, { type: 'commit', action: 'stashApply' });
		add('stashPop', `Pop ${chip.name}…`, { type: 'commit', action: 'stashPop' });
		add('stashBranch', `Create Branch from ${chip.name}…`, {
			type: 'commit',
			action: 'stashBranch',
		});
		add(
			'stashDrop',
			`Drop ${chip.name}…`,
			{ type: 'commit', action: 'stashDrop' },
			{ separatorBefore: true }
		);
		return { items, mapEntries };
	}

	if (chip.kind === 'tag') {
		add('pushTag', `Push ${chip.name} to origin…`, { type: 'commit', action: 'pushTag' });
		add(
			'deleteTag',
			`Delete ${chip.name}…`,
			{ type: 'commit', action: 'deleteTag' },
			{ separatorBefore: true }
		);
		add('deleteRemoteTag', `Delete ${chip.name} from origin…`, {
			type: 'commit',
			action: 'deleteRemoteTag',
		});
		add(
			'copyRefName',
			'Copy Tag Name',
			{ type: 'commit', action: 'copyRefName' },
			{ separatorBefore: true }
		);
		return { items, mapEntries };
	}

	// Detached HEAD is a position, not a ref anything can be done to. An empty menu is the signal
	// to fall through to the commit menu, which carries everything that applies to it.
	if (chip.kind === 'head') return { items, mapEntries };

	const labelFor = (remote: string): string => remoteRefLabel({ remote, branch: chip.name });

	if (chip.hasLocal && !chip.checkedOut)
		add('checkoutBranch', `Checkout ${chip.name}`, { type: 'commit', action: 'checkoutBranch' });
	// One entry per remote, never a single entry standing for the first of several: the label has
	// to name the ref the action will actually touch.
	for (const remote of chip.listRemotes) {
		// Without a local branch the host's `checkoutBranch` already falls through to the remote
		// path, so the two cases differ only in which action id says so plainly.
		const action = chip.hasLocal ? 'checkoutRemote' : 'checkoutBranch';
		add(
			action,
			`Checkout ${labelFor(remote)} as local branch`,
			{
				type: 'commit',
				action,
			},
			{ remote }
		);
	}
	for (const remote of chip.listRemotes)
		add(
			'fetchIntoLocal',
			`Fetch ${labelFor(remote)} into ${chip.name}…`,
			{ type: 'commit', action: 'fetchIntoLocal' },
			{ remote }
		);

	// Filter by the ref the chip most plainly stands for: the local branch when there is one,
	// otherwise the first remote's ref — and the label names that ref outright.
	const filterRef =
		chip.hasLocal || chip.listRemotes.length === 0 ? chip.name : labelFor(chip.listRemotes[0]);
	add(
		'filterBranch',
		`Show Only ${filterRef}`,
		{ type: 'filter', ref: filterRef },
		{ separatorBefore: true }
	);

	// Merging a branch into itself is a no-op git would refuse; without a current branch there is
	// nothing to merge *into*, so the pair drops out entirely.
	if (currentBranch && !chip.checkedOut) {
		add(
			'mergeInto',
			`Merge ${chip.name} into ${currentBranch}…`,
			{ type: 'branch', action: 'mergeInto', target: currentBranch },
			{ separatorBefore: true }
		);
		add('rebaseOnto', `Rebase ${currentBranch} onto ${chip.name}…`, {
			type: 'branch',
			action: 'rebaseOnto',
			target: currentBranch,
		});
	}

	// Renaming the checked-out branch is fine — `branch -m` moves HEAD's ref along with it.
	if (chip.hasLocal)
		add(
			'renameBranch',
			`Rename ${chip.name}…`,
			{ type: 'commit', action: 'renameBranch' },
			{ separatorBefore: true }
		);
	// The checked-out branch keeps its delete entry, disabled: git refuses to delete it anyway, and
	// saying so where the user looked beats a gap they have to explain to themselves.
	if (chip.hasLocal)
		add('deleteBranch', `Delete ${chip.name}…`, { type: 'commit', action: 'deleteBranch' }, {
			disabled: chip.checkedOut,
		});
	chip.listRemotes.forEach((remote, index) =>
		add(
			'deleteRemoteBranch',
			`Delete ${labelFor(remote)}…`,
			{ type: 'commit', action: 'deleteRemoteBranch' },
			{ separatorBefore: !chip.hasLocal && index === 0, remote }
		)
	);

	add(
		'copyRefName',
		'Copy Branch Name',
		{ type: 'commit', action: 'copyRefName' },
		{ separatorBefore: true }
	);
	return { items, mapEntries };
}

/**
 * The item a selected id stands for, or null when the id names nothing selectable.
 *
 * Menus are one level deep, so this looks through children as well. A disabled item resolves to
 * null: `ContextMenu` will not fire one, and this is the second place that has to agree, since a
 * disabled entry means the action was ruled out — not merely discouraged.
 */
export function resolveMenuSelection(items: MenuItem[], id: string): MenuItem | null {
	for (const item of items) {
		if (item.id === id) return item.disabled || item.children ? null : item;
		const child = item.children?.find((candidate) => candidate.id === id);
		if (child) return child.disabled ? null : child;
	}
	return null;
}

/** What a ref's submenu is called: its name, in the form the chip itself shows. */
function refSubmenuLabel(chip: RefChip): string {
	if (chip.kind === 'tag') return `Tag ${chip.name}`;
	const remote = chip.listRemotes[0];
	if (chip.kind === 'branch' && !chip.hasLocal && remote)
		return remoteRefLabel({ remote, branch: chip.name });
	return chip.name;
}

/**
 * The context menu for a single commit: what applies to the commit itself, then one submenu per
 * ref sitting on it.
 *
 * The refs get submenus rather than flat entries because a commit may carry several branches, and
 * a flat `Delete Branch…` can only ask which one afterwards — throwing away the fact that the user
 * already pointed at one. Nesting makes the pointing itself the answer.
 */
export function buildCommitMenuItems(
	commit: Commit,
	currentBranch: string | null,
	listChips: RefChip[] = []
): RefMenu {
	const stashRef = commit.refs.find((r) => r.kind === 'stash');
	if (stashRef) {
		return {
			items: [
				{ id: 'stashApply', label: 'Apply Stash…' },
				{ id: 'stashPop', label: 'Pop Stash…' },
				{ id: 'stashBranch', label: 'Create Branch from Stash…' },
				{ id: 'stashDrop', label: 'Drop Stash…', separatorBefore: true },
				{ id: 'copyHash', label: 'Copy Commit Hash', separatorBefore: true },
				{ id: 'copySubject', label: 'Copy Subject' },
			],
			mapEntries: {},
		};
	}
	// Naming the branch beats "current branch": on a graph of many branches it is the one thing
	// the reader cannot infer from where they right-clicked.
	const here = currentBranch ?? 'the current branch';
	const items: MenuItem[] = [
		{ id: 'checkout', label: 'Checkout Commit' },
		{ id: 'createBranch', label: 'Create Branch…' },
		{ id: 'addTag', label: 'Add Tag…' },
		{ id: 'merge', label: `Merge into ${here}…`, separatorBefore: true },
		{ id: 'rebase', label: `Rebase ${here} on this Commit…` },
		{ id: 'cherryPick', label: 'Cherry Pick…' },
		{ id: 'revert', label: 'Revert…' },
		{ id: 'reword', label: 'Reword Message…' },
		{
			id: 'reset',
			label: `Reset ${here} to this Commit`,
			children: [
				{ id: 'resetSoft', label: 'Soft — keep all changes, staged' },
				{ id: 'resetMixed', label: 'Mixed — keep changes, unstaged' },
				{ id: 'resetHard', label: 'Hard — discard all changes' },
			],
		},
	];

	const mapEntries: Record<string, RefMenuEntry> = {};
	let firstRef = true;
	listChips.forEach((chip) => {
		const menu = buildRefMenu(chip, currentBranch);
		if (menu.items.length === 0) return;
		items.push({
			id: refKey(chip),
			label: refSubmenuLabel(chip),
			separatorBefore: firstRef,
			// One flat list inside: a separator there would read as nesting that is not there.
			children: menu.items.map((item) => ({ ...item, separatorBefore: false })),
		});
		Object.assign(mapEntries, menu.mapEntries);
		firstRef = false;
	});

	items.push({ id: 'openOnRemote', label: 'Open on Remote', separatorBefore: true });
	items.push({ id: 'copyRemoteUrl', label: 'Copy Remote URL' });
	items.push({ id: 'copyHash', label: 'Copy Commit Hash' });
	items.push({ id: 'copySubject', label: 'Copy Subject' });
	return { items, mapEntries };
}

export const mapMultiAction: Record<string, 'squash' | 'drop' | 'cherryPick' | 'revert'> = {
	squashSelected: 'squash',
	dropSelected: 'drop',
	cherryPickSelected: 'cherryPick',
	revertSelected: 'revert',
};
