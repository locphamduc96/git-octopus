import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { WorkingTreeActionMessage } from '@git-octopus/shared';
import { withIgnoreEntry } from '../../core/git/gitignoreEntry.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

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
				const confirmed = await prompt.confirm({
					title: 'Git Octopus',
					message: `Discard changes in ${message.path}? This cannot be undone.`,
					confirmLabel: 'Discard',
					danger: true,
				});
				if (!confirmed) return false;
				// Untracked files aren't in HEAD, so checkout fails — fall back to removing them.
				try {
					await this.executor.run(['checkout', 'HEAD', '--', message.path], cwd);
					return true;
				} catch {
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
			case 'undoCommit':
				// Soft reset: the commit's changes come back staged, ready to be redone.
				return this.runGit(['reset', '--soft', 'HEAD~1'], cwd);
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
				return this.runGit(['commit', '-m', messageText], cwd, 'Committed.');
			}
			case 'amend': {
				// An empty message keeps the previous one rather than blocking the amend.
				const amendText = (message.message ?? '').trim();
				const args =
					amendText === ''
						? ['commit', '--amend', '--no-edit']
						: ['commit', '--amend', '-m', amendText];
				return this.runGit(args, cwd, 'Amended the last commit.');
			}
			default:
				return false;
		}
	}

	/**
	 * Appends the file to the repository's `.gitignore`. Returns true so the graph refreshes: the
	 * file drops out of the untracked list the moment the pattern lands.
	 */
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
			vscode.window.showErrorMessage(
				`Git Octopus: ${err instanceof Error ? err.message : String(err)}`
			);
			return false;
		}
	}
}
