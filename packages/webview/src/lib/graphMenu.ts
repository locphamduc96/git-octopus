import type { BranchActionId, Commit, CommitActionId } from '@git-octopus/shared';
import { remoteRefLabel } from '@git-octopus/shared';
import type { RefChip } from './graphChips';
import { isSquashableChain } from './squashRange';
import type { MenuItem } from './ui/ContextMenu.svelte';
import type { ColumnVisibility } from './viewSettings';

/** The header's right-click menu: one checkable entry per optional column. */
export function buildHeaderMenuItems(
	columns: ColumnVisibility
): MenuItem<keyof ColumnVisibility>[] {
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
): MenuItem<BranchActionId>[] {
	if (!drop) return [];
	const items: MenuItem<BranchActionId>[] = [
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
export function buildMultiMenuItems(listSelectedCommits: Commit[]): MenuBuild {
	const n = listSelectedCommits.length;
	const chain = isSquashableChain(listSelectedCommits);
	// Cherry-pick and revert replay commits one by one, so they only need merge-free picks,
	// not a contiguous chain.
	const noMerges = listSelectedCommits.every((commit) => commit.parents.length === 1);
	const listItems: MenuItem[] = [];
	const mapEntries: Record<string, MenuEntry> = {};

	// Disabled entries keep their run: `resolveMenuSelection` is the one place that rules an entry
	// out, so an entry map with holes in it would only give the same answer twice.
	const addMulti = (
		id: string,
		action: MultiAction,
		label: string,
		extra?: { disabled?: boolean; separatorBefore?: boolean }
	): void => {
		listItems.push({
			id,
			label,
			disabled: extra?.disabled,
			separatorBefore: extra?.separatorBefore,
		});
		mapEntries[id] = { type: 'multi', action };
	};

	addMulti('squashSelected', 'squash', `Squash ${n} Commits…`, { disabled: !chain });
	addMulti('dropSelected', 'drop', `Drop ${n} Commits…`, { disabled: !chain });
	addMulti('cherryPickSelected', 'cherryPick', `Cherry Pick ${n} Commits…`, {
		disabled: !noMerges,
		separatorBefore: true,
	});
	addMulti('revertSelected', 'revert', `Revert ${n} Commits…`, { disabled: !noMerges });

	if (!chain) {
		listItems.push({
			id: 'multiHint',
			label: noMerges
				? 'Squash/Drop need a consecutive run on one branch'
				: 'Selection contains merge commits',
			disabled: true,
			separatorBefore: true,
		});
	}
	return { items: listItems, mapEntries };
}

/** What acting on a whole multi-selection does, newest → oldest. */
export type MultiAction = 'squash' | 'drop' | 'cherryPick' | 'revert';

/**
 * The exact ref an action runs on. A chip may stand for a local branch and the same branch on
 * several remotes at once, so naming the chip is not enough: `remote` picks out which of them the
 * entry meant, and an entry without it is about the local ref.
 */
export interface RefTarget {
	chip: RefChip;
	remote?: string;
}

/**
 * What selecting one menu entry runs.
 *
 * Flat rather than a payload nested inside a wrapper: a `switch` on `type` then narrows the whole
 * entry, so the dispatcher reads each variant's fields without re-checking anything. Every
 * selectable entry of every menu gets one, which is what keeps the ids themselves free to be
 * built at run time — the id is a key, never something to be read back as an action.
 */
export type MenuEntry =
	// The commit-action protocol. `target` is set only on entries built from a ref menu, where the
	// payload is narrowed to that one ref.
	| { type: 'commit'; action: CommitActionId; target?: RefTarget }
	// The branch-action protocol the drag gesture already uses, where source and target are both
	// named outright: `target` is the ref acted on, `onto` the local branch git will write.
	| { type: 'branch'; action: BranchActionId; target: RefTarget; onto: string }
	// Handled inside the webview: the graph reloads with `ref` as its only walk root. The ref is
	// resolved here, at build time, so the entry itself says what `git log` will be handed.
	| { type: 'filter'; ref: string }
	// Acts on the whole multi-selection rather than on the commit the menu was opened over.
	| { type: 'multi'; action: MultiAction };

/** A built menu: what is drawn, and what each of its selectable ids runs. */
export interface MenuBuild {
	items: MenuItem[];
	/** Menu-item id -> what selecting it runs. Ids that open a submenu are absent. */
	mapEntries: Record<string, MenuEntry>;
}

/** A ref entry before its ref is attached: the caller knows the run, the adder knows the chip. */
type RefRun =
	| { type: 'commit'; action: CommitActionId }
	| { type: 'branch'; action: BranchActionId; onto: string }
	| { type: 'filter'; ref: string };

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
export function buildRefMenu(chip: RefChip, currentBranch: string | null): MenuBuild {
	const listItems: MenuItem[] = [];
	const mapEntries: Record<string, MenuEntry> = {};
	const prefix = refKey(chip);

	const addRefEntry = (
		action: string,
		label: string,
		run: RefRun,
		extra?: { separatorBefore?: boolean; disabled?: boolean; remote?: string }
	): void => {
		const id = extra?.remote ? `${prefix}:${action}:${extra.remote}` : `${prefix}:${action}`;
		listItems.push({
			id,
			label,
			separatorBefore: extra?.separatorBefore,
			disabled: extra?.disabled,
		});
		// A filter resolved its ref at build time and acts on no ref of its own.
		mapEntries[id] =
			run.type === 'filter' ? run : { ...run, target: { chip, remote: extra?.remote } };
	};

	if (chip.kind === 'stash') {
		addRefEntry('stashApply', `Apply ${chip.name}…`, { type: 'commit', action: 'stashApply' });
		addRefEntry('stashPop', `Pop ${chip.name}…`, { type: 'commit', action: 'stashPop' });
		addRefEntry('stashBranch', `Create Branch from ${chip.name}…`, {
			type: 'commit',
			action: 'stashBranch',
		});
		addRefEntry(
			'stashDrop',
			`Drop ${chip.name}…`,
			{ type: 'commit', action: 'stashDrop' },
			{ separatorBefore: true }
		);
		return { items: listItems, mapEntries };
	}

	if (chip.kind === 'tag') {
		addRefEntry('pushTag', `Push ${chip.name} to origin…`, { type: 'commit', action: 'pushTag' });
		addRefEntry(
			'deleteTag',
			`Delete ${chip.name}…`,
			{ type: 'commit', action: 'deleteTag' },
			{ separatorBefore: true }
		);
		addRefEntry('deleteRemoteTag', `Delete ${chip.name} from origin…`, {
			type: 'commit',
			action: 'deleteRemoteTag',
		});
		addRefEntry(
			'copyRefName',
			'Copy Tag Name',
			{ type: 'commit', action: 'copyRefName' },
			{ separatorBefore: true }
		);
		return { items: listItems, mapEntries };
	}

	// Detached HEAD is a position, not a ref anything can be done to. An empty menu is the signal
	// to fall through to the commit menu, which carries everything that applies to it.
	if (chip.kind === 'head') return { items: listItems, mapEntries };

	const labelFor = (remote: string): string => remoteRefLabel({ remote, branch: chip.name });

	if (chip.hasLocal && !chip.checkedOut)
		addRefEntry('checkoutBranch', `Checkout ${chip.name}`, {
			type: 'commit',
			action: 'checkoutBranch',
		});
	// One entry per remote, never a single entry standing for the first of several: the label has
	// to name the ref the action will actually touch.
	for (const remote of chip.listRemotes) {
		// Without a local branch the host's `checkoutBranch` already falls through to the remote
		// path, so the two cases differ only in which action id says so plainly.
		const action = chip.hasLocal ? 'checkoutRemote' : 'checkoutBranch';
		addRefEntry(
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
		addRefEntry(
			'fetchIntoLocal',
			`Fetch ${labelFor(remote)} into ${chip.name}…`,
			{ type: 'commit', action: 'fetchIntoLocal' },
			{ remote }
		);

	// Filter by the ref the chip most plainly stands for: the local branch when there is one,
	// otherwise the first remote's ref — and the label names that ref outright.
	const filterRef =
		chip.hasLocal || chip.listRemotes.length === 0 ? chip.name : labelFor(chip.listRemotes[0]);
	addRefEntry(
		'filterBranch',
		`Show Only ${filterRef}`,
		{ type: 'filter', ref: filterRef },
		{ separatorBefore: true }
	);

	// Merging a branch into itself is a no-op git would refuse; without a current branch there is
	// nothing to merge *into*, so the pair drops out entirely.
	if (currentBranch && !chip.checkedOut) {
		addRefEntry(
			'mergeInto',
			`Merge ${chip.name} into ${currentBranch}…`,
			{ type: 'branch', action: 'mergeInto', onto: currentBranch },
			{ separatorBefore: true }
		);
		addRefEntry('rebaseOnto', `Rebase ${currentBranch} onto ${chip.name}…`, {
			type: 'branch',
			action: 'rebaseOnto',
			onto: currentBranch,
		});
	}

	// Renaming the checked-out branch is fine — `branch -m` moves HEAD's ref along with it.
	if (chip.hasLocal)
		addRefEntry(
			'renameBranch',
			`Rename ${chip.name}…`,
			{ type: 'commit', action: 'renameBranch' },
			{ separatorBefore: true }
		);
	// The checked-out branch keeps its delete entry, disabled: git refuses to delete it anyway, and
	// saying so where the user looked beats a gap they have to explain to themselves.
	if (chip.hasLocal)
		addRefEntry('deleteBranch', `Delete ${chip.name}…`, { type: 'commit', action: 'deleteBranch' }, {
			disabled: chip.checkedOut,
		});
	chip.listRemotes.forEach((remote, index) =>
		addRefEntry(
			'deleteRemoteBranch',
			`Delete ${labelFor(remote)}…`,
			{ type: 'commit', action: 'deleteRemoteBranch' },
			{ separatorBefore: !chip.hasLocal && index === 0, remote }
		)
	);

	addRefEntry(
		'copyRefName',
		'Copy Branch Name',
		{ type: 'commit', action: 'copyRefName' },
		{ separatorBefore: true }
	);
	return { items: listItems, mapEntries };
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
): MenuBuild {
	const listItems: MenuItem[] = [];
	const mapEntries: Record<string, MenuEntry> = {};

	/** An entry about the commit itself: its id is the action, and it runs under that id. */
	const addCommitEntry = (
		action: CommitActionId,
		label: string,
		separatorBefore?: boolean
	): void => {
		listItems.push({ id: action, label, separatorBefore });
		mapEntries[action] = { type: 'commit', action };
	};

	const stashRef = commit.refs.find((r) => r.kind === 'stash');
	if (stashRef) {
		addCommitEntry('stashApply', 'Apply Stash…');
		addCommitEntry('stashPop', 'Pop Stash…');
		addCommitEntry('stashBranch', 'Create Branch from Stash…');
		addCommitEntry('stashDrop', 'Drop Stash…', true);
		addCommitEntry('copyHash', 'Copy Commit Hash', true);
		addCommitEntry('copySubject', 'Copy Subject');
		return { items: listItems, mapEntries };
	}

	// Naming the branch beats "current branch": on a graph of many branches it is the one thing
	// the reader cannot infer from where they right-clicked.
	const here = currentBranch ?? 'the current branch';
	addCommitEntry('checkout', 'Checkout Commit');
	addCommitEntry('createBranch', 'Create Branch…');
	addCommitEntry('addTag', 'Add Tag…');
	addCommitEntry('merge', `Merge into ${here}…`, true);
	addCommitEntry('rebase', `Rebase ${here} on this Commit…`);
	addCommitEntry('cherryPick', 'Cherry Pick…');
	addCommitEntry('revert', 'Revert…');
	addCommitEntry('reword', 'Reword Message…');

	const listResetModes: { action: CommitActionId; label: string }[] = [
		{ action: 'resetSoft', label: 'Soft — keep all changes, staged' },
		{ action: 'resetMixed', label: 'Mixed — keep changes, unstaged' },
		{ action: 'resetHard', label: 'Hard — discard all changes' },
	];
	// The parent only opens the flyout, so it gets no entry of its own.
	listItems.push({
		id: 'reset',
		label: `Reset ${here} to this Commit`,
		children: listResetModes.map((mode) => ({ id: mode.action, label: mode.label })),
	});
	for (const mode of listResetModes)
		mapEntries[mode.action] = { type: 'commit', action: mode.action };

	let firstRef = true;
	listChips.forEach((chip) => {
		const menu = buildRefMenu(chip, currentBranch);
		if (menu.items.length === 0) return;
		listItems.push({
			id: refKey(chip),
			label: refSubmenuLabel(chip),
			separatorBefore: firstRef,
			// One flat list inside: a separator there would read as nesting that is not there.
			children: menu.items.map((item) => ({ ...item, separatorBefore: false })),
		});
		Object.assign(mapEntries, menu.mapEntries);
		firstRef = false;
	});

	addCommitEntry('openOnRemote', 'Open on Remote', true);
	addCommitEntry('copyRemoteUrl', 'Copy Remote URL');
	addCommitEntry('copyHash', 'Copy Commit Hash');
	addCommitEntry('copySubject', 'Copy Subject');
	return { items: listItems, mapEntries };
}
