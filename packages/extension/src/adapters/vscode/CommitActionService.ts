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
			case 'merge': {
				const options = await vscode.window.showQuickPick(
					[
						{ label: 'No fast-forward', description: 'Always create a merge commit', picked: true },
						{ label: 'Squash commits', description: 'Combine into a single change' },
						{ label: 'No commit', description: 'Stage the merge without committing' },
					],
					{ canPickMany: true, placeHolder: `Merge ${short} — choose options` }
				);
				if (!options) return false;
				const args = ['merge', message.hash];
				if (options.some((option) => option.label === 'Squash commits')) args.push('--squash');
				else if (options.some((option) => option.label === 'No fast-forward')) args.push('--no-ff');
				if (options.some((option) => option.label === 'No commit')) args.push('--no-commit');
				return this.runGit(args, cwd, `Merged ${short}.`);
			}
			case 'checkoutRemote': {
				const remote = await this.pickRemote(message.remoteBranches, 'Checkout which remote branch?');
				if (!remote) return false;
				const local = remote.slice(remote.indexOf('/') + 1);
				return this.runGit(['checkout', '-b', local, '--track', remote], cwd, `Checked out ${local}.`);
			}
			case 'deleteRemoteBranch': {
				const remote = await this.pickRemote(message.remoteBranches, 'Delete which remote branch?');
				if (!remote) return false;
				const slash = remote.indexOf('/');
				const remoteName = remote.slice(0, slash);
				const branchName = remote.slice(slash + 1);
				if (!(await this.confirm(`Delete ${remote} from the remote? This cannot be undone.`)))
					return false;
				return this.runGit(
					['push', remoteName, '--delete', branchName],
					cwd,
					`Deleted ${remote}.`
				);
			}
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
			case 'stashApply':
			case 'stashPop':
			case 'stashDrop':
			case 'stashBranch':
				return this.runStashAction(message, cwd);
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

	private async runStashAction(message: CommitActionMessage, cwd: string): Promise<boolean> {
		const stash = message.stashName;
		if (!stash) return false;
		switch (message.action) {
			case 'stashApply':
				if (!(await this.confirm(`Apply ${stash} to the working tree?`))) return false;
				return this.runGit(['stash', 'apply', stash], cwd, `Applied ${stash}.`);
			case 'stashPop':
				if (!(await this.confirm(`Pop ${stash} into the working tree?`))) return false;
				return this.runGit(['stash', 'pop', stash], cwd, `Popped ${stash}.`);
			case 'stashDrop':
				if (!(await this.confirm(`Drop ${stash}? This cannot be undone.`))) return false;
				return this.runGit(['stash', 'drop', stash], cwd, `Dropped ${stash}.`);
			case 'stashBranch': {
				const name = await this.askName(`Name for the new branch from ${stash}`);
				if (!name) return false;
				return this.runGit(['stash', 'branch', name, stash], cwd, `Created branch ${name}.`);
			}
			default:
				return false;
		}
	}

	private async pickRemote(
		listRemotes: string[],
		placeHolder: string
	): Promise<string | undefined> {
		if (listRemotes.length === 0) return undefined;
		if (listRemotes.length === 1) return listRemotes[0];
		return vscode.window.showQuickPick(listRemotes, { placeHolder });
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
