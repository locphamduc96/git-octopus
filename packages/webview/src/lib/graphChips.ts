import type { Ref, RemoteBranchRef, UpstreamTracking } from '@git-octopus/shared';
import { hasGap, remoteRefLabel, remoteRefPath } from '@git-octopus/shared';

/** One chip drawn in the Branch / Tag column, standing for one or more refs at a commit. */
export interface RefChip {
	kind: 'branch' | 'tag' | 'stash' | 'head';
	name: string;
	checkedOut: boolean;
	hasLocal: boolean;
	listRemotes: string[];
	title: string;
	/** Drift from the upstream, for a chip with a local branch that has one. */
	tracking: UpstreamTracking | null;
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
 * Detached HEAD is the exception. There is no branch for the tick to sit on, so it takes a chip —
 * without one the graph says nothing at all about where the working tree is.
 *
 * Ordering puts the chips a reader looks for first at the front: stash, then the checked-out
 * branch, then the branch last picked this session, then other local branches, then remote-only
 * ones, and tags last.
 */
export function buildChips(
	refs: Ref[],
	currentBranch: string | null,
	lastPicked: string | null,
	mapTracking: Record<string, UpstreamTracking | null> = {}
): RefChip[] {
	const mapBranches = new Map<string, RefChip>();
	const listStashes: RefChip[] = [];
	const listTags: RefChip[] = [];
	const listHead: RefChip[] = [];

	for (const ref of refs) {
		if (ref.kind === 'head') {
			if (currentBranch === null) {
				listHead.push({
					kind: 'head',
					name: 'HEAD',
					// Not `checkedOut`: that flag paints a chip in its branch's colour, and this chip
					// has a colour of its own precisely because it is not a branch.
					checkedOut: false,
					hasLocal: false,
					listRemotes: [],
					title: 'HEAD is detached here — not on any branch',
					tracking: null,
				});
			}
			continue;
		}
		if (ref.kind === 'tag' || ref.kind === 'stash') {
			const chip: RefChip = {
				kind: ref.kind,
				name: ref.name,
				checkedOut: false,
				hasLocal: false,
				listRemotes: [],
				title: ref.kind === 'tag' ? `Tag ${ref.name}` : `Stash ${ref.name}`,
				tracking: null,
			};
			if (ref.kind === 'tag') listTags.push(chip);
			else listStashes.push(chip);
			continue;
		}
		const chip: RefChip = mapBranches.get(ref.name) ?? {
			kind: 'branch' as const,
			name: ref.name,
			checkedOut: false,
			hasLocal: false,
			listRemotes: [],
			title: '',
			tracking: null,
		};
		if (ref.remote) chip.listRemotes.push(ref.remote);
		else chip.hasLocal = true;
		mapBranches.set(ref.name, chip);
	}

	for (const chip of mapBranches.values()) {
		chip.checkedOut = chip.hasLocal && chip.name === currentBranch;
		// Only a local branch has an upstream. A chip standing for `origin/x` alone has nothing to
		// be measured against, so it carries no tracking however much the map knows about the name.
		chip.tracking = chip.hasLocal ? (mapTracking[chip.name] ?? null) : null;
		const listParts: string[] = [];
		if (chip.hasLocal) listParts.push(chip.checkedOut ? 'checked out' : 'local branch');
		for (const remote of chip.listRemotes) listParts.push(`${remote}/${chip.name}`);
		if (chip.tracking) listParts.push(trackingSummary(chip.tracking));
		chip.title = `${chip.name} — ${listParts.join(', ')}`;
	}

	const listBranches = [...mapBranches.values()].sort(
		(a, b) => branchRank(a, lastPicked) - branchRank(b, lastPicked)
	);
	// HEAD leads: while detached it is the one thing on the row a reader is looking for.
	return [...listHead, ...listStashes, ...listBranches, ...listTags];
}

/**
 * How a chip's drift reads in a tooltip.
 *
 * Every state that is not `gone` ends in the same caveat. `%(upstream:track)` is measured against
 * `refs/remotes/*` on disk, so all of these numbers — "in sync" very much included — describe the
 * repository as it stood at the last fetch, not as it stands now.
 */
export function trackingSummary(tracking: UpstreamTracking): string {
	if (tracking.gone) return `upstream ${tracking.upstream} is gone`;
	const count = (n: number | null): string => (n === null ? 'some' : String(n));
	const listGaps: string[] = [];
	if (hasGap(tracking.ahead)) listGaps.push(`${count(tracking.ahead)} ahead`);
	if (hasGap(tracking.behind)) listGaps.push(`${count(tracking.behind)} behind`);
	const gap =
		listGaps.length === 0
			? `in sync with ${tracking.upstream}`
			: `${listGaps.join(', ')} ${tracking.upstream}`;
	return `${gap} — as of your last fetch`;
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

/** The remote-tracking branch a chip stands for, remote and branch kept apart. */
export function chipRemote(chip: RefChip): RemoteBranchRef | null {
	const remote = chip.listRemotes[0];
	return remote ? { remote, branch: chip.name } : null;
}

/**
 * The ref a chip stands for: its local name when it has one, else its first remote-tracking one.
 *
 * `ref` is what git is handed and `label` is what the user reads. They differ for a remote,
 * where only the full path is unambiguous — a remote may be named with a slash in it, or with
 * a leading dash that an option parser would swallow.
 */
export function chipRef(chip: RefChip): { ref: string; label: string } | null {
	if (chip.hasLocal) return { ref: chip.name, label: chip.name };
	const remote = chipRemote(chip);
	return remote ? { ref: remoteRefPath(remote), label: remoteRefLabel(remote) } : null;
}

/**
 * A branch chip other than the one being dragged. A local branch takes every drop action; a chip
 * that stands only for a remote branch takes the ones that write no remote-tracking ref here —
 * rebasing onto it, pushing to it — since that ref is a copy of someone else's, not ours to move.
 * `dragLabel` is the label of the chip being dragged, or null while nothing is.
 */
export function isDropTarget(chip: RefChip, dragLabel: string | null): boolean {
	if (dragLabel === null || chip.kind !== 'branch') return false;
	const label = chipRef(chip)?.label;
	return label !== undefined && label !== dragLabel;
}
