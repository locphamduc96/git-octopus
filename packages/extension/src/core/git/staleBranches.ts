import type { BranchInventoryEntry } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

/**
 * committerdate, not authordate: rebasing or cherry-picking a branch keeps the original author
 * date, so an authordate-based age would call a branch touched yesterday six months old.
 */
export const INVENTORY_FORMAT =
	'%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(HEAD)%00%(upstream:track)%00%(contents:subject)';

export const INVENTORY_ARGS = ['for-each-ref', `--format=${INVENTORY_FORMAT}`, 'refs/heads'];

export function parseBranchInventory(
	output: string,
	setMerged: ReadonlySet<string>
): BranchInventoryEntry[] {
	const listEntries: BranchInventoryEntry[] = [];
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [name, hash, committedAt, head, track, ...listRest] = line.split('\0');
		if (!name) continue;
		listEntries.push({
			name,
			hash: hash ?? '',
			// Subjects can contain anything, including a NUL-free but delimiter-looking string; the
			// subject is last in the format, so whatever remains belongs to it.
			subject: listRest.join('\0'),
			committedAt: committedAt ?? '',
			merged: setMerged.has(name),
			upstreamGone: (track ?? '').includes('gone'),
			current: head === '*',
		});
	}
	return listEntries;
}

/** Branch names listed by `git branch --merged`, with the marker column and padding stripped. */
export function parseMergedBranches(output: string): Set<string> {
	const setMerged = new Set<string>();
	for (const line of output.split('\n')) {
		const name = line.replace(/^[*+]?\s*/, '').trim();
		// Detached HEAD prints as "(HEAD detached at abc1234)" — a state, not a branch.
		if (name === '' || name.startsWith('(')) continue;
		setMerged.add(name);
	}
	return setMerged;
}

export interface BranchInventory {
	listBranches: BranchInventoryEntry[];
	/** The revision "merged" was measured against, or null when it could not be determined. */
	mergedBase: string | null;
}

/**
 * Every local branch with the metadata the cleanup dialog filters on. Fetched in one shot: the
 * dialog re-filters by age client-side, so a slider drag must not cost a round trip.
 */
export async function getBranchInventory(
	executor: GitExecutor,
	cwd: string,
	base: string
): Promise<BranchInventory> {
	const output = await executor.run(INVENTORY_ARGS, cwd);
	let setMerged = new Set<string>();
	let mergedBase: string | null = base;
	try {
		setMerged = parseMergedBranches(await executor.run(['branch', '--merged', base], cwd));
	} catch {
		// An empty repository has no commits to merge into. Everything is then simply "not merged",
		// which is the safe answer — it only ever means the user has to tick the box themselves.
		mergedBase = null;
	}
	return { listBranches: parseBranchInventory(output, setMerged), mergedBase };
}
