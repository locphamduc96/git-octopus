import * as vscode from 'vscode';
import type { BranchCleanupOutcome, CleanupBranchesMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** Deletes local branches picked in the cleanup dialog. */
export class BranchCleanupService {
	public constructor(private readonly executor: GitExecutor) {}

	/**
	 * One `git branch -d` per branch rather than one call listing them all: a single refusal
	 * (unmerged, checked out in another worktree) aborts the whole batch and leaves the user unable
	 * to tell which branches survived. Per-branch, every name comes back with its own verdict.
	 */
	public async run(
		message: CleanupBranchesMessage,
		cwd: string
	): Promise<{ listResults: BranchCleanupOutcome[]; changed: boolean }> {
		const flag = message.force ? '-D' : '-d';
		const listResults: BranchCleanupOutcome[] = [];
		for (const name of message.listNames) {
			// The name goes onto a git command line, so nothing that could read as an option may
			// pass — a crafted message must not be able to smuggle flags into `git branch`.
			if (name.startsWith('-') || name.trim() === '') {
				listResults.push({ name, hash: '', ok: false, reason: 'not a valid branch name' });
				continue;
			}
			// Read the tip before deleting: it is what lets the user put a branch back afterwards.
			const hash = await this.tipOf(name, cwd);
			// Every deletion must be pinned to the tip the dialog showed. A name without a pin was
			// never offered by the dialog; a tip that moved since means the user would be deleting
			// commits they never saw. Both are refused; the result table tells them to rescan.
			const expected = (message.mapExpectedTips as Record<string, string> | undefined)?.[name];
			if (expected === undefined || expected !== hash) {
				listResults.push({
					name,
					hash,
					ok: false,
					reason: 'the branch has moved since the list was loaded — rescan and pick again',
				});
				continue;
			}
			try {
				await this.executor.run(['branch', flag, '--', name], cwd);
				listResults.push({ name, hash, ok: true });
			} catch (error) {
				listResults.push({
					name,
					hash,
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
		const deleted = listResults.filter((result) => result.ok).length;
		const failed = listResults.length - deleted;
		if (deleted > 0) {
			vscode.window.showInformationMessage(
				failed === 0
					? `Git Octopus: deleted ${deleted} ${deleted === 1 ? 'branch' : 'branches'}.`
					: `Git Octopus: deleted ${deleted} of ${listResults.length} branches — ${failed} could not be deleted.`
			);
		} else if (failed > 0) {
			vscode.window.showErrorMessage(
				`Git Octopus: no branches were deleted — ${listResults[0].reason ?? 'unknown error'}`
			);
		}
		return { listResults, changed: deleted > 0 };
	}

	private async tipOf(name: string, cwd: string): Promise<string> {
		try {
			// The full ref, not the short name: `rev-parse release` prefers a tag of the same name
			// over the branch, and this hash is what the user is told to restore the branch from.
			return (await this.executor.run(['rev-parse', '--verify', `refs/heads/${name}`], cwd)).trim();
		} catch {
			return '';
		}
	}
}
