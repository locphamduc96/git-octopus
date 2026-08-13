import * as vscode from 'vscode';
import type { CommitActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/**
 * Runs commit context-menu actions. Lives in the adapter layer because each action needs VS Code
 * UI (prompts, clipboard, notifications) and mutates the repository.
 */
export class CommitActionService {
	public constructor(private readonly executor: GitExecutor) {}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(message: CommitActionMessage, cwd: string): Promise<boolean> {
		const short = message.hash.slice(0, 7);
		switch (message.action) {
			case 'copyHash':
				await vscode.env.clipboard.writeText(message.hash);
				vscode.window.showInformationMessage('Git Octopus: commit hash copied.');
				return false;
			case 'copySubject':
				await vscode.env.clipboard.writeText(message.subject);
				vscode.window.showInformationMessage('Git Octopus: subject copied.');
				return false;
			case 'checkout':
				if (!(await this.confirm(`Checkout commit ${short}? HEAD will be detached.`))) return false;
				return this.runGit(['checkout', message.hash], cwd, `Checked out ${short}.`);
			case 'createBranch': {
				const name = await vscode.window.showInputBox({
					prompt: `Name for the new branch at ${short}`,
					validateInput: (value) => (value.trim() === '' ? 'Branch name is required.' : undefined),
				});
				if (!name) return false;
				return this.runGit(['branch', name.trim(), message.hash], cwd, `Created branch ${name.trim()}.`);
			}
			case 'merge':
				if (!(await this.confirm(`Merge commit ${short} into the current branch?`))) return false;
				return this.runGit(['merge', message.hash], cwd, `Merged ${short}.`);
			case 'deleteBranch': {
				const branch =
					message.branches.length === 1
						? message.branches[0]
						: await vscode.window.showQuickPick(message.branches, {
								placeHolder: 'Delete which branch?',
							});
				if (!branch) return false;
				return this.runGit(['branch', '-d', branch], cwd, `Deleted branch ${branch}.`);
			}
			default:
				return false;
		}
	}

	private async confirm(prompt: string): Promise<boolean> {
		const pick = await vscode.window.showWarningMessage(prompt, { modal: true }, 'Yes');
		return pick === 'Yes';
	}

	private async runGit(args: string[], cwd: string, successMessage: string): Promise<boolean> {
		try {
			await this.executor.run(args, cwd);
			vscode.window.showInformationMessage(`Git Octopus: ${successMessage}`);
			return true;
		} catch (err) {
			vscode.window.showErrorMessage(
				`Git Octopus: ${err instanceof Error ? err.message : String(err)}`
			);
			return false;
		}
	}
}
