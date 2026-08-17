import * as vscode from 'vscode';
import type { WorkingTreeActionMessage } from '@git-octopus/shared';
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
