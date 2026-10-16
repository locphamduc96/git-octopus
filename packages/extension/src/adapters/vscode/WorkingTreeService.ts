import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { StageLinesMessage, WorkingTreeActionMessage } from '@git-octopus/shared';
import { buildPartialPatch } from '../../core/git/partialPatch.js';
import { workingSideDiffArgs } from '../../core/git/gitService.js';
import { EMPTY_TREE } from '../../core/git/workingTreeDiff.js';
import { assertNever } from '@git-octopus/shared';
import { withIgnoreEntry } from '../../core/git/gitignoreEntry.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { showGitError } from './staleLockNotice.js';

/** Runs working-tree actions (stage / unstage / commit). Adapter: mutates repo + shows UI errors. */
export class WorkingTreeService {
	public constructor(private readonly executor: GitExecutor) {}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(
		message: WorkingTreeActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		switch (message.action) {
			case 'stage':
				return message.path ? this.runGit(['add', '--', message.path], cwd) : false;
			case 'unstage':
				return message.path ? this.runGit(['reset', '-q', 'HEAD', '--', message.path], cwd) : false;
			case 'stageAll':
				return this.runGit(['add', '-A'], cwd);
			case 'unstageAll':
				return this.runGit(['reset', '-q', 'HEAD'], cwd);
			case 'discard': {
				if (!message.path) return false;
				// A submodule's change is the commit its checkout is on, and `checkout HEAD --` cannot
				// move that — with `submodule.recurse` set it would check the submodule out instead,
				// which is not what "discard" promised either. Neither is run.
				const index = await this.executor
					.run(['ls-files', '--stage', '--', message.path], cwd)
					.catch(() => '');
				if (index.startsWith('160000 ')) {
					vscode.window.showWarningMessage(
						`Git Octopus: ${message.path} is a submodule — discarding here cannot reset it. Run “git submodule update -- ${message.path}” to put it back on the recorded commit, or open the submodule to discard the changes inside it.`
					);
					return false;
				}
				const confirmed = await prompt.confirm({
					title: 'Git Octopus',
					message: `Discard changes in ${message.path}? This cannot be undone.`,
					confirmLabel: 'Discard',
					danger: true,
				});
				if (!confirmed) return false;
				// Untracked files aren't in HEAD, so checkout fails — fall back to removing them.
				//
				// Only for that one failure, and it has to be proven from the message. `checkout` also
				// fails when `.git/index.lock` is held, and treating that as "must be untracked" would
				// delete a tracked file the user only asked to revert.
				try {
					await this.executor.run(['checkout', 'HEAD', '--', message.path], cwd);
					return true;
				} catch (err) {
					const raw = err instanceof Error ? err.message : String(err);
					if (!/did not match any file/.test(raw)) {
						void showGitError(raw, cwd);
						return false;
					}
					return this.runGit(['clean', '-fd', '--', message.path], cwd);
				}
			}
			case 'ignore': {
				if (!message.path) return false;
				return this.addToGitignore(message.path, cwd);
			}
			case 'ignoreAndUntrack': {
				if (!message.path) return false;
				const confirmed = await prompt.confirm({
					title: 'Git Octopus',
					message: `Stop tracking ${message.path} and add it to .gitignore? The file stays on your disk, but the next commit removes it for everyone else.`,
					confirmLabel: 'Stop Tracking',
					danger: true,
				});
				if (!confirmed) return false;
				// The index change first: it is the part that can fail, and failing before the pattern
				// is written leaves nothing half-done.
				if (!(await this.runGit(['rm', '--cached', '--', message.path], cwd))) return false;
				await this.addToGitignore(message.path, cwd);
				return true;
			}
			case 'restoreFromCommit': {
				if (!message.path || !message.hash) return false;
				const short = message.hash.slice(0, 8);
				const confirmed = await prompt.confirm({
					title: 'Git Octopus',
					message: `Restore ${message.path} as it was at ${short}? Uncommitted changes to this file are replaced; the restored file is staged.`,
					confirmLabel: 'Restore',
				});
				if (!confirmed) return false;
				return this.runGit(
					['restore', `--source=${message.hash}`, '--staged', '--worktree', '--', message.path],
					cwd,
					`Restored ${message.path} from ${short}.`
				);
			}
			case 'applyFromStash': {
				// One file out of a stash, the way `stash apply` would bring it back: into the working
				// tree only, the index left alone, and the stash kept.
				if (!message.path || !message.hash || !/^[0-9a-f]{7,64}$/.test(message.hash)) return false;
				const local = (
					await this.executor.run(['status', '--porcelain', '--', message.path], cwd)
				).trim();
				if (local !== '') {
					const confirmed = await prompt.confirm({
						title: 'Git Octopus',
						message: `${message.path} has changes of its own. Replace them with the stashed version?`,
						confirmLabel: 'Replace',
						danger: true,
					});
					if (!confirmed) return false;
				}
				return this.runGit(
					['restore', `--source=${message.hash}`, '--worktree', '--', message.path],
					cwd,
					`Applied ${message.path} from the stash.`
				);
			}
			case 'undoCommit':
				// Soft reset: the commit's changes come back staged, ready to be redone.
				return this.runGit(['reset', '--soft', 'HEAD~1'], cwd);
			case 'takeOurs':
			case 'takeTheirs': {
				if (!message.path) return false;
				const side = message.action === 'takeOurs' ? '--ours' : '--theirs';
				// Taking a side resolves the file, so it is staged in the same step — that is what
				// "resolved" means to git, and what lets the merge or rebase continue.
				if (!(await this.runGit(['checkout', side, '--', message.path], cwd))) return false;
				return this.runGit(['add', '--', message.path], cwd, `Resolved ${message.path} (${side}).`);
			}
			case 'restoreConflict':
				if (!message.path) return false;
				return this.runGit(
					['checkout', '-m', '--', message.path],
					cwd,
					`Restored the conflict markers in ${message.path}.`
				);
			case 'openMergeEditor': {
				if (!message.path) return false;
				// The merge editor belongs to VS Code's own Git extension; reusing it beats a three-pane
				// tool of our own.
				try {
					await vscode.commands.executeCommand(
						'git.openMergeEditor',
						vscode.Uri.file(path.join(cwd, message.path))
					);
				} catch {
					vscode.window.showErrorMessage(
						"Git Octopus: the merge editor needs VS Code's built-in Git extension to be enabled."
					);
				}
				return false;
			}
			case 'stashFile': {
				if (!message.path) return false;
				const name = await prompt.inputText({
					title: `Stash ${message.path}`,
					prompt: 'Optional message for the stash',
				});
				if (name === undefined) return false;
				// `--include-untracked` so a file git does not track yet can be put away too.
				const args = ['stash', 'push', '--include-untracked'];
				if (name.trim() !== '') args.push('-m', name.trim());
				args.push('--', message.path);
				return this.runGit(args, cwd, `Stashed ${message.path}.`);
			}
			case 'stash': {
				const name = await prompt.inputText({
					title: 'Stash changes',
					prompt: 'Optional message for the stash',
				});
				if (name === undefined) return false;
				const args = ['stash', 'push', '--include-untracked'];
				if (name.trim() !== '') args.push('-m', name.trim());
				return this.runGit(args, cwd, 'Stashed uncommitted changes.');
			}
			case 'commit': {
				const messageText = (message.message ?? '').trim();
				if (messageText === '') {
					vscode.window.showWarningMessage('Git Octopus: commit message is empty.');
					return false;
				}
				return this.runGit(
					['commit', ...(message.noVerify ? ['--no-verify'] : []), '-m', messageText],
					cwd,
					'Committed.'
				);
			}
			case 'amend': {
				// An empty message keeps the previous one rather than blocking the amend.
				const amendText = (message.message ?? '').trim();
				const listHooks = message.noVerify ? ['--no-verify'] : [];
				const args =
					amendText === ''
						? ['commit', '--amend', ...listHooks, '--no-edit']
						: ['commit', '--amend', ...listHooks, '-m', amendText];
				return this.runGit(args, cwd, 'Amended the last commit.');
			}
			default:
				assertNever(message.action);
				return false;
		}
	}

	/**
	 * Appends the file to the repository's `.gitignore`. Returns true so the graph refreshes: the
	 * file drops out of the untracked list the moment the pattern lands.
	 */
	/**
	 * Stage, unstage or discard the picked lines of one file.
	 *
	 * The file's diff is read again here, not taken from the view: the patch must describe the index
	 * and the disk as they are now, and `buildPartialPatch` refuses when a picked line no longer reads
	 * the same. Unstaging reads the staged side, the other two the unstaged side — anything else is a
	 * view asking for something its own diff could not have shown.
	 */
	public async stageLines(
		message: StageLinesMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const expectedSide = message.action === 'unstage' ? 'staged' : 'unstaged';
		if (message.side !== expectedSide || message.listLines.length === 0) return false;

		let rawDiff: string;
		try {
			rawDiff = await this.executor.run(workingSideDiffArgs(message.side, [], [message.path]), cwd);
		} catch (err) {
			// Before the first commit there is no HEAD for the staged side to be measured from.
			if (message.side !== 'staged') {
				void showGitError(err instanceof Error ? err.message : String(err), cwd);
				return false;
			}
			rawDiff = await this.executor.run(
				workingSideDiffArgs('staged', [], [message.path], EMPTY_TREE),
				cwd
			);
		}
		const result = buildPartialPatch(
			rawDiff,
			message.listLines,
			message.action === 'stage' ? 'forward' : 'reverse'
		);
		if ('error' in result) {
			vscode.window.showWarningMessage(`Git Octopus: ${result.error}`);
			return false;
		}

		const count = message.listLines.length;
		const lines = `${count} line${count === 1 ? '' : 's'}`;
		if (message.action === 'discard') {
			const confirmed = await prompt.confirm({
				title: 'Git Octopus',
				message: `Discard ${lines} in ${message.path}? This cannot be undone.`,
				confirmLabel: 'Discard',
				danger: true,
			});
			if (!confirmed) return false;
		}

		// A file rather than stdin: the executor has no stdin, and one short-lived file costs less
		// than threading one through every layer that wraps it.
		const patchFile = path.join(
			os.tmpdir(),
			`git-octopus-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`
		);
		try {
			await fs.writeFile(patchFile, result.patch, 'utf8');
			return await this.runGit(
				[
					'apply',
					'--recount',
					'--whitespace=nowarn',
					...(message.action === 'discard' ? [] : ['--cached']),
					...(message.action === 'stage' ? [] : ['--reverse']),
					patchFile,
				],
				cwd
			);
		} finally {
			await fs.rm(patchFile, { force: true });
		}
	}

	private async addToGitignore(repoRelativePath: string, cwd: string): Promise<boolean> {
		const file = path.join(cwd, '.gitignore');
		try {
			if (await this.isIgnored(repoRelativePath, cwd)) {
				vscode.window.showInformationMessage(
					`Git Octopus: ${repoRelativePath} is already ignored.`
				);
				return false;
			}
			// A missing .gitignore is the normal first case, not an error.
			const current = await fs.readFile(file, 'utf8').catch(() => '');
			const next = withIgnoreEntry(current, repoRelativePath);
			// The line is already there, yet git says the path is not ignored — something later in
			// the file overrides it (a `!` rule, most likely). Appending a duplicate would not
			// change that, so say what happened instead of failing silently.
			if (next === null) {
				vscode.window.showInformationMessage(
					`Git Octopus: .gitignore already lists ${repoRelativePath}, but a later rule un-ignores it — edit .gitignore by hand.`
				);
				return false;
			}
			await fs.writeFile(file, next, 'utf8');
			return true;
		} catch (err) {
			vscode.window.showErrorMessage(
				`Git Octopus: ${err instanceof Error ? err.message : String(err)}`
			);
			return false;
		}
	}

	/**
	 * Whether git already ignores the path — the only answer that accounts for patterns, so a file
	 * covered by an existing `*.log` does not collect a redundant entry of its own.
	 *
	 * Deliberately without `-q`: the executor hands back stdout, and quiet mode leaves it empty for
	 * both answers. Plain `check-ignore` prints the path when a pattern matches and stays silent
	 * when none does, which is what makes the two distinguishable. Exit 1 is that silence, not a
	 * failure; anything above it still throws.
	 */
	private async isIgnored(repoRelativePath: string, cwd: string): Promise<boolean> {
		const output = await this.executor.run(['check-ignore', '--', repoRelativePath], cwd, [1]);
		return output.trim() !== '';
	}

	private async runGit(args: string[], cwd: string, successMessage?: string): Promise<boolean> {
		try {
			await this.executor.run(args, cwd);
			if (successMessage) vscode.window.showInformationMessage(`Git Octopus: ${successMessage}`);
			return true;
		} catch (err) {
			void showGitError(err instanceof Error ? err.message : String(err), cwd);
			return false;
		}
	}
}
