import * as vscode from 'vscode';
import type { WorkingTreeActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** Runs working-tree actions (stage / unstage / commit). Adapter: mutates repo + shows UI errors. */
export class WorkingTreeService {
	public constructor(private readonly executor: GitExecutor) {}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(message: WorkingTreeActionMessage, cwd: string): Promise<boolean> {
		switch (message.action) {
			case 'stage':
				return message.path ? this.runGit(['add', '--', message.path], cwd) : false;
			case 'unstage':
				return message.path ? this.runGit(['reset', '-q', 'HEAD', '--', message.path], cwd) : false;
			case 'stageAll':
				return this.runGit(['add', '-A'], cwd);
			case 'unstageAll':
				return this.runGit(['reset', '-q', 'HEAD'], cwd);
			case 'commit': {
				const messageText = (message.message ?? '').trim();
				if (messageText === '') {
					vscode.window.showWarningMessage('Git Octopus: commit message is empty.');
					return false;
				}
				return this.runGit(['commit', '-m', messageText], cwd, 'Committed.');
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
