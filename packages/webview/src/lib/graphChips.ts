import type { Ref } from '@git-octopus/shared';

/** One chip drawn in the Branch / Tag column, standing for one or more refs at a commit. */
export interface RefChip {
	kind: 'branch' | 'tag' | 'stash';
	name: string;
	checkedOut: boolean;
	hasLocal: boolean;
	listRemotes: string[];
	title: string;
}

export interface ChipGroups {
	listVisible: RefChip[];
	/** Branch chips beyond the first — folded into the `+N` popover. */
	listOverflow: RefChip[];
}

/**
 * Collapse a commit's refs into compact chips: a branch present both locally and on remotes becomes
 * one chip carrying both markers, and the standalone HEAD ref is folded into a tick on the
 * checked-out branch instead of taking a chip of its own.
 *
 * Ordering puts the chips a reader looks for first at the front: stash, then the checked-out
 * branch, then the branch last picked this session, then other local branches, then remote-only
 * ones, and tags last.
 */
export function buildChips(
	refs: Ref[],
	currentBranch: string | null,
	lastPicked: string | null
): RefChip[] {
	const mapBranches = new Map<string, RefChip>();
	const listStashes: RefChip[] = [];
	const listTags: RefChip[] = [];

	for (const ref of refs) {
		if (ref.kind === 'head') continue;
		if (ref.kind === 'tag' || ref.kind === 'stash') {
			const chip: RefChip = {
				kind: ref.kind,
				name: ref.name,
				checkedOut: false,
				hasLocal: false,
				listRemotes: [],
				title: ref.kind === 'tag' ? `Tag ${ref.name}` : `Stash ${ref.name}`,
			};
			if (ref.kind === 'tag') listTags.push(chip);
			else listStashes.push(chip);
			continue;
		}
		const chip = mapBranches.get(ref.name) ?? {
			kind: 'branch' as const,
			name: ref.name,
			checkedOut: false,
			hasLocal: false,
			listRemotes: [],
			title: '',
		};
		if (ref.remote) chip.listRemotes.push(ref.remote);
		else chip.hasLocal = true;
		mapBranches.set(ref.name, chip);
	}

	for (const chip of mapBranches.values()) {
		chip.checkedOut = chip.hasLocal && chip.name === currentBranch;
		const listParts: string[] = [];
		if (chip.hasLocal) listParts.push(chip.checkedOut ? 'checked out' : 'local branch');
		for (const remote of chip.listRemotes) listParts.push(`${remote}/${chip.name}`);
		chip.title = `${chip.name} — ${listParts.join(', ')}`;
	}

	const listBranches = [...mapBranches.values()].sort(
		(a, b) => branchRank(a, lastPicked) - branchRank(b, lastPicked)
	);
	return [...listStashes, ...listBranches, ...listTags];
}

/** Checked-out first, then the branch last picked this session, then local, then remote-only. */
export function branchRank(chip: RefChip, lastPicked: string | null): number {
	if (chip.checkedOut) return 0;
	if (chip.name === lastPicked) return 1;
	return chip.hasLocal ? 2 : 3;
}

/** GitKraken-style collapse: one branch chip stays visible, the rest hide behind `+N`. */
export function splitChips(listChips: RefChip[]): ChipGroups {
	const listBranch = listChips.filter((chip) => chip.kind === 'branch');
	const setOverflow = new Set(listBranch.slice(1));
	return {
		listVisible: listChips.filter((chip) => !setOverflow.has(chip)),
		listOverflow: listBranch.slice(1),
	};
}
