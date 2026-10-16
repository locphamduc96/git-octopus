import type { HostShell } from '../../app/ports/shell.js';
import { showGitError } from './staleLockNotice.js';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { isFirstParentRun } from '../../core/git/rewriteGuards.js';

/**
 * The engine behind every history rewrite below HEAD — squash, drop, reword — and the guards
 * that decide whether one may run at all. Lives in the adapter layer because refusals are shown
 * as VS Code error messages; the git-level proofs it relies on are in `core/git/rewriteGuards`.
 */
export class HistoryRewriter {
	public constructor(
		private readonly executor: GitExecutor,
		private readonly shell: HostShell
	) {}

	/** See {@link isFirstParentRun} — the host's re-proof of a squash/drop selection. */
	public verifyFirstParentRun(listHashes: string[], cwd: string): Promise<boolean> {
		return isFirstParentRun(this.executor, listHashes, cwd);
	}

	public staleSelectionError(): void {
		this.shell.notify.error(
			'Git Octopus: the selection no longer matches the repository history — refresh the graph and try again.'
		);
	}

	/**
	 * Shared guards for every history rewrite below HEAD. Returns the branch to rewrite and the
	 * commit HEAD stood at when the guards held, or null (with the reason already shown) when the
	 * rewrite must not run. Callers re-run this after their prompts close and require the same
	 * branch AND the same head: a tip that advanced — even linearly — carries commits the user
	 * never saw in the selection they confirmed.
	 */
	public async guardRewrite(
		newest: string,
		cwd: string
	): Promise<{ branch: string; head: string } | null> {
		const branch = await this.currentBranch(cwd);
		if (!branch) {
			this.shell.notify.error('Git Octopus: cannot rewrite history while HEAD is detached.');
			return null;
		}
		if (!(await this.canFastForward('HEAD', newest, cwd))) {
			this.shell.notify.error(
				`Git Octopus: the selected commits are not on ${branch} — check their branch out first.`
			);
			return null;
		}
		// Replaying a merge with plain rebase silently flattens it; refuse rather than rewrite topology.
		const merges = (
			await this.executor.run(['rev-list', '--merges', `${newest}..HEAD`], cwd)
		).trim();
		if (merges !== '') {
			this.shell.notify.error(
				'Git Octopus: there are merge commits above the selection — rewriting would flatten them.'
			);
			return null;
		}
		// A rewrite ends in a rebase, and rebase refuses a dirty tree; staged changes would also be
		// swept into any commit the rewrite makes.
		const dirty = (
			await this.executor.run(['status', '--porcelain', '--untracked-files=no'], cwd)
		).trim();
		if (dirty !== '') {
			this.shell.notify.error(
				'Git Octopus: commit or stash your changes before rewriting history.'
			);
			return null;
		}
		const head = (await this.executor.run(['rev-parse', 'HEAD'], cwd)).trim();
		return { branch, head };
	}

	/** Whether a re-run of the guards proves the same branch at the same tip as `first`. */
	public guardUnchanged(
		first: { branch: string; head: string },
		again: { branch: string; head: string } | null
	): boolean {
		return again !== null && again.branch === first.branch && again.head === first.head;
	}

	/**
	 * The engine behind squash / drop / reword: detach at `detachAt`, run `listSteps` to shape the
	 * new tip, then replay everything above `oldTip` onto it and point the branch there.
	 *
	 * The branch ref is only touched by that final rebase, so any earlier failure leaves it exactly
	 * where it was; a failure inside the rebase is aborted and the branch checked out again.
	 */
	public async rewriteBelow(
		cwd: string,
		branch: string,
		detachAt: string,
		oldTip: string,
		listSteps: string[][],
		successMessage: string
	): Promise<boolean> {
		try {
			await this.executor.run(['checkout', '--detach', detachAt], cwd);
			for (const args of listSteps) await this.executor.run(args, cwd);
			const newTip = (await this.executor.run(['rev-parse', 'HEAD'], cwd)).trim();
			await this.executor.run(['rebase', '--onto', newTip, oldTip, branch], cwd);
			this.shell.notify.info(`Git Octopus: ${successMessage}`);
		} catch (err) {
			try {
				await this.executor.run(['rebase', '--abort'], cwd);
			} catch {
				// No rebase in progress — the failure came earlier.
			}
			try {
				await this.executor.run(['checkout', branch], cwd);
			} catch {
				// Leave HEAD as it stands; the error below tells the user where things stopped.
			}
			void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd, {
				lead: 'rewrite failed',
				note: `Branch ${branch} was not changed.`,
			});
		}
		// HEAD moved either way, so the graph needs a refresh even after a failure.
		return true;
	}

	/**
	 * Replay a contiguous run at the tip of `branch` onto `target`, and leave the branch there.
	 *
	 * `rebase --onto` in its plain form — no detach, no intermediate tip — because nothing is being
	 * reshaped here: the same commits are being given a different base. That also means the branch
	 * ref is the one thing rebase writes, so a failure that aborts leaves it exactly where it was.
	 */
	public async rebaseRangeOnto(
		cwd: string,
		branch: string,
		exclusiveBase: string,
		target: string,
		successMessage: string
	): Promise<boolean> {
		try {
			await this.executor.run(['rebase', '--onto', target, exclusiveBase, branch], cwd);
			this.shell.notify.info(`Git Octopus: ${successMessage}`);
		} catch (err) {
			try {
				await this.executor.run(['rebase', '--abort'], cwd);
			} catch {
				// Nothing in progress: the failure was in starting the rebase, not in replaying it.
			}
			try {
				await this.executor.run(['checkout', branch], cwd);
			} catch {
				// Leave HEAD as it stands; the error below says where things stopped.
			}
			void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd, {
				lead: 'rebase failed',
				note: `Branch ${branch} was not changed.`,
			});
		}
		// A conflict stops the rebase mid-run and leaves the sequencer open, so the graph refreshes
		// either way — the banner is what tells the user what to do next.
		return true;
	}

	/** Whether `target` is an ancestor of `source`, i.e. whether it can be fast-forwarded to it. */
	public async canFastForward(source: string, target: string, cwd: string): Promise<boolean> {
		try {
			await this.executor.run(['merge-base', '--is-ancestor', target, source], cwd);
			return true;
		} catch {
			return false;
		}
	}

	public async currentBranch(cwd: string): Promise<string | null> {
		try {
			const name = (await this.executor.run(['symbolic-ref', '--short', 'HEAD'], cwd)).trim();
			return name === '' ? null : name;
		} catch {
			// Detached HEAD: no branch to compare against, so every action checks one out first.
			return null;
		}
	}
}
