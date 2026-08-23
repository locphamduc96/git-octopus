import type { BranchCleanupOutcome, BranchInventoryEntry } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/** The branch-cleanup dialog: what it is offering to delete, and what came of it. */

let open = $state(false);
/** Null while the scan is still running — what the dialog reads as "loading". */
let inventory = $state<{
	listBranches: BranchInventoryEntry[];
	mergedBase: string | null;
} | null>(null);
let listResults = $state<BranchCleanupOutcome[] | null>(null);

onHostType('branchInventory', (message) => {
	inventory = { listBranches: message.listBranches, mergedBase: message.mergedBase };
});

onHostType('branchCleanupResult', (message) => {
	listResults = message.listResults;
});

onRepoReset(() => {
	open = false;
	inventory = null;
	listResults = null;
});

export const branchCleanup = {
	get open(): boolean {
		return open;
	},
	get listBranches(): BranchInventoryEntry[] {
		return inventory?.listBranches ?? [];
	},
	get mergedBase(): string | null {
		return inventory?.mergedBase ?? null;
	},
	get loading(): boolean {
		return inventory === null;
	},
	get listResults(): BranchCleanupOutcome[] | null {
		return listResults;
	},
	openDialog(): void {
		// Always re-scan: branches move between openings, and a stale list would offer to delete a
		// branch that has since been pushed to.
		inventory = null;
		listResults = null;
		open = true;
		postToHost({ type: 'loadBranchInventory' });
	},
	close(): void {
		open = false;
	},
	deleteBranches(listNames: string[], force: boolean): void {
		postToHost({
			type: 'cleanupBranches',
			repoPath: session.repoPath,
			listNames,
			// The tips as this dialog showed them: the host refuses a branch that moved since.
			mapExpectedTips: Object.fromEntries(
				(inventory?.listBranches ?? [])
					.filter((branch) => listNames.includes(branch.name))
					.map((branch) => [branch.name, branch.hash])
			),
			force,
		});
	},
};
