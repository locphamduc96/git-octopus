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
				const name = await this.askName(`Name for the new branch at ${short}`);
				if (!name) return false;
				return this.runGit(['branch', name, message.hash], cwd, `Created branch ${name}.`);
			}
			case 'addTag': {
				const name = await this.askName(`Name for the new tag at ${short}`);
				if (!name) return false;
				return this.runGit(['tag', name, message.hash], cwd, `Created tag ${name}.`);
			}
			case 'merge':
				if (!(await this.confirm(`Merge commit ${short} into the current branch?`))) return false;
				return this.runGit(['merge', message.hash], cwd, `Merged ${short}.`);
			case 'rebase':
				if (!(await this.confirm(`Rebase the current branch onto ${short}?`))) return false;
				return this.runGit(['rebase', message.hash], cwd, `Rebased onto ${short}.`);
			case 'cherryPick':
				if (!(await this.confirm(`Cherry pick commit ${short} onto the current branch?`)))
					return false;
				return this.runGit(['cherry-pick', message.hash], cwd, `Cherry picked ${short}.`);
			case 'revert':
				if (!(await this.confirm(`Revert commit ${short}?`))) return false;
				return this.runGit(['revert', '--no-edit', message.hash], cwd, `Reverted ${short}.`);
			case 'reset': {
				const mode = await vscode.window.showQuickPick(
					[
						{ label: 'Mixed', description: 'Keep working tree, reset index', value: '--mixed' },
						{ label: 'Soft', description: 'Keep all changes, move HEAD only', value: '--soft' },
						{ label: 'Hard', description: 'Discard all changes', value: '--hard' },
					],
					{ placeHolder: `Reset the current branch to ${short} using which mode?` }
				);
				if (!mode) return false;
				if (
					mode.value === '--hard' &&
					!(await this.confirm('Hard reset discards all uncommitted changes. Continue?'))
				) {
					return false;
				}
				return this.runGit(['reset', mode.value, message.hash], cwd, `Reset to ${short}.`);
			}
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

	private async askName(prompt: string): Promise<string | undefined> {
		const value = await vscode.window.showInputBox({
			prompt,
			validateInput: (input) => (input.trim() === '' ? 'A name is required.' : undefined),
		});
		return value?.trim() || undefined;
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
