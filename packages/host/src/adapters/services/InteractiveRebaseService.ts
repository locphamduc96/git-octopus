import type { HostShell } from '../../app/ports/shell.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InteractiveRebaseMessage, RebaseTodoMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	buildTodo,
	parseRebaseTodoLog,
	rebaseTodoLogArgs,
	shellQuote,
	validateSteps,
} from '../../core/git/interactiveRebase.js';
import { showGitError } from './staleLockNotice.js';
import type { HistoryRewriter } from './HistoryRewriter.js';

/**
 * Rewrite the commits after a base in one go: reorder, reword, squash, fix up and drop them.
 *
 * Everything the editor showed is proved again before anything runs — the branch, the commits in
 * the range, no merges in it, a clean tree — because the editor may have sat open while the
 * repository moved.
 */
export class InteractiveRebaseService {
	public constructor(
		private readonly executor: GitExecutor,
		private readonly shell: HostShell,
		private readonly rewriter: HistoryRewriter
	) {}

	/**
	 * The commits to rewrite, oldest first — or why they cannot be. Without `branch` they are HEAD's
	 * commits after `base`; with it, the commits of that branch that `base` does not have, which a
	 * rebase moves onto `base`.
	 */
	public async load(base: string, cwd: string, branch?: string): Promise<RebaseTodoMessage> {
		const refuse = (error: string): RebaseTodoMessage => ({
			type: 'rebaseTodo',
			base,
			...(branch ? { branch } : {}),
			listCommits: [],
			error,
		});
		const why = await this.whyNot(base, cwd, branch);
		if (why) return refuse(why);
		const listCommits = parseRebaseTodoLog(
			await this.executor.run(rebaseTodoLogArgs(base, branch ?? 'HEAD'), cwd)
		);
		if (listCommits.length === 0) {
			return refuse(
				branch
					? `${branch} has nothing that ${base} does not have.`
					: 'There is nothing after this commit to rewrite.'
			);
		}
		return { type: 'rebaseTodo', base, ...(branch ? { branch } : {}), listCommits };
	}

	public async run(message: InteractiveRebaseMessage, cwd: string): Promise<boolean> {
		const fail = (text: string): false => {
			this.shell.notify.error(`Git Octopus: ${text}`);
			return false;
		};
		const invalid = validateSteps(message.listSteps);
		if (invalid) return fail(invalid);
		const why = await this.whyNot(message.base, cwd, message.branch);
		if (why) return fail(why);
		const tip = message.branch ?? 'HEAD';
		const dirty = (
			await this.executor.run(['status', '--porcelain', '--untracked-files=no'], cwd)
		).trim();
		if (dirty !== '') return fail('commit or stash your changes before rewriting history.');

		// The steps have to name exactly the commits in the range now: one more, one less or one
		// different means the editor was built over a history that has since moved.
		const listInRange = (
			await this.executor.run(['rev-list', '--reverse', `${message.base}..${tip}`], cwd)
		)
			.split('\n')
			.filter((hash) => hash !== '');
		const listAsked = message.listSteps.map((step) => step.hash);
		if (
			listInRange.length !== listAsked.length ||
			[...listInRange].sort().join() !== [...listAsked].sort().join()
		) {
			return fail('the branch moved since the editor opened — open it again.');
		}

		const current = await this.rewriter.currentBranch(cwd);
		const branch = message.branch ?? current ?? '';
		// Rebasing another branch onto `base` means standing on it first; the tree is clean, so the
		// checkout cannot carry anything along.
		if (message.branch && message.branch !== current) {
			try {
				await this.executor.run(['checkout', message.branch], cwd);
			} catch (err) {
				void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd);
				return false;
			}
		}
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-octopus-rebase-'));
		try {
			const todo = path.join(tempDir, 'todo');
			await fs.writeFile(todo, buildTodo(message.listSteps), 'utf8');
			// The sequence editor copies our todo over git's; `true` as the editor keeps squash from
			// stopping to ask for a message — git's own combination of both is kept.
			const todoForSh = process.platform === 'win32' ? todo.replace(/\\/g, '/') : todo;
			await this.executor.run(
				[
					'-c',
					`sequence.editor=cp ${shellQuote(todoForSh)}`,
					'-c',
					'core.editor=true',
					'rebase',
					'-i',
					'--no-autosquash',
					message.base,
				],
				cwd
			);
			this.shell.notify.info(
				`Git Octopus: rewrote ${listAsked.length} commit${listAsked.length === 1 ? '' : 's'} on ${branch}.`
			);
		} catch (err) {
			if (await this.pausedOnConflict(cwd)) {
				this.shell.notify.warn(
					'Git Octopus: the rebase stopped on a conflict — resolve the files, then Continue (or Abort) from the banner.'
				);
				return true;
			}
			try {
				await this.executor.run(['rebase', '--abort'], cwd);
			} catch {
				// Nothing in progress: the failure came before the rebase started.
			}
			void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd, {
				lead: 'interactive rebase failed',
				note: `Branch ${branch} was not changed.`,
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
		return true;
	}

	/**
	 * Why the commits cannot be rewritten, or null. In place (no `branch`): HEAD on a branch with
	 * `base` below it. Onto another branch: `branch` is a local branch. No merges either way — a
	 * linear replay would flatten them.
	 */
	private async whyNot(base: string, cwd: string, branch?: string): Promise<string | null> {
		if (branch) {
			try {
				await this.executor.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
			} catch {
				return `${branch} is not a local branch.`;
			}
		} else {
			if (!(await this.rewriter.currentBranch(cwd))) {
				return 'HEAD is detached — check a branch out to rewrite its history.';
			}
			if (!(await this.rewriter.canFastForward('HEAD', base, cwd))) {
				return 'this commit is not in the history of the checked-out branch.';
			}
		}
		const tip = branch ?? 'HEAD';
		const merges = (
			await this.executor.run(['rev-list', '--merges', `${base}..${tip}`], cwd)
		).trim();
		if (merges !== '') {
			return 'there are merge commits after this one — rewriting would flatten them.';
		}
		return null;
	}

	private async pausedOnConflict(cwd: string): Promise<boolean> {
		try {
			return (await this.executor.run(['ls-files', '--unmerged'], cwd)).trim() !== '';
		} catch {
			return false;
		}
	}
}
