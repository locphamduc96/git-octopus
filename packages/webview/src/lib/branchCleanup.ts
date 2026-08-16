import type { BranchInventoryEntry } from '@git-octopus/shared';

/**
 * Never offered for deletion, whatever their age. Long-lived trunks are stale by nature — nobody
 * commits straight to them on a healthy repo — so age alone would put them at the top of the list.
 */
export const LIST_PROTECTED = ['main', 'master', 'develop', 'dev'];

export const LIST_MONTH_PRESETS = [1, 3, 6, 12];

export interface CleanupRow {
	entry: BranchInventoryEntry;
	/** Whole months since the tip commit, rounded down. */
	ageMonths: number;
	ageLabel: string;
	/** Whether the row's checkbox can be ticked at all. */
	selectable: boolean;
	/** Why it cannot be ticked, or the caveat of ticking it. Empty when there is nothing to say. */
	reason: string;
	/** Ticked when the dialog opens: old, merged, and nothing to lose. */
	defaultChecked: boolean;
}

/**
 * Calendar months rather than 30-day blocks: the user picks "older than 3 months" thinking in
 * calendar terms, and a branch last touched on 15 March is 3 months old on 15 June either way.
 */
export function monthsBetween(fromIso: string, now: Date): number {
	const from = new Date(fromIso);
	if (Number.isNaN(from.getTime())) return 0;
	let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
	// The final month has not elapsed until the day-of-month comes round again.
	if (now.getDate() < from.getDate()) months -= 1;
	return Math.max(0, months);
}

function ageLabelOf(committedAt: string, now: Date): string {
	const from = new Date(committedAt);
	if (Number.isNaN(from.getTime())) return 'unknown';
	const days = Math.floor((now.getTime() - from.getTime()) / 86_400_000);
	if (days < 1) return 'today';
	if (days < 30) return `${days}d ago`;
	const months = monthsBetween(committedAt, now);
	if (months < 12) return `${Math.max(1, months)}mo ago`;
	const years = Math.floor(months / 12);
	const rest = months % 12;
	return rest === 0 ? `${years}y ago` : `${years}y ${rest}mo ago`;
}

export interface DescribeOptions {
	now: Date;
	listProtected?: string[];
}

export function describeEntry(entry: BranchInventoryEntry, options: DescribeOptions): CleanupRow {
	const listProtected = options.listProtected ?? LIST_PROTECTED;
	const ageMonths = monthsBetween(entry.committedAt, options.now);
	const row = {
		entry,
		ageMonths,
		ageLabel: ageLabelOf(entry.committedAt, options.now),
	};
	if (entry.current) {
		return { ...row, selectable: false, reason: 'checked out', defaultChecked: false };
	}
	if (listProtected.includes(entry.name)) {
		return { ...row, selectable: false, reason: 'protected', defaultChecked: false };
	}
	if (!entry.merged) {
		// Deletable, but only with -D, and only because the user said so explicitly.
		return {
			...row,
			selectable: true,
			reason: 'not merged — deleting loses these commits',
			defaultChecked: false,
		};
	}
	return {
		...row,
		selectable: true,
		reason: entry.upstreamGone ? 'upstream deleted' : '',
		defaultChecked: true,
	};
}

export interface BuildRowsOptions extends DescribeOptions {
	/** Keep branches whose tip is at least this many months old. */
	months: number;
}

/**
 * Rows for the dialog: only branches at or past the age threshold, oldest first. Protected and
 * checked-out branches stay in the list when they qualify by age — dropping them silently reads as
 * "the scan missed something" rather than "these are off limits".
 */
export function buildCleanupRows(
	listEntries: BranchInventoryEntry[],
	options: BuildRowsOptions
): CleanupRow[] {
	return listEntries
		.map((entry) => describeEntry(entry, options))
		.filter((row) => row.ageMonths >= options.months)
		.sort((a, b) => b.ageMonths - a.ageMonths || a.entry.name.localeCompare(b.entry.name));
}

/** Names ticked when the dialog opens or the threshold changes. */
export function defaultSelection(listRows: CleanupRow[]): Set<string> {
	return new Set(listRows.filter((row) => row.defaultChecked).map((row) => row.entry.name));
}

/**
 * Deleting unmerged branches needs `-D`, which also force-deletes the merged ones — so one flag
 * for the whole batch is decided by whether anything unmerged was picked.
 */
export function needsForce(listRows: CleanupRow[], setSelected: ReadonlySet<string>): boolean {
	return listRows.some((row) => setSelected.has(row.entry.name) && !row.entry.merged);
}
