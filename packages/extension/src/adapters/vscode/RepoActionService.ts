import * as vscode from 'vscode';
import type { RepoActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** Runs repository-wide network actions (fetch / push) with progress and error reporting. */
export class RepoActionService {
	public constructor(private readonly executor: GitExecutor) {}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(message: RepoActionMessage, cwd: string): Promise<boolean> {
		const isFetch = message.action === 'fetch';
		const args = isFetch ? ['fetch', '--all', '--prune'] : ['push'];
		const title = isFetch ? 'Git Octopus: fetching…' : 'Git Octopus: pushing…';

		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title },
			async () => {
				try {
					await this.executor.run(args, cwd);
					vscode.window.showInformationMessage(
						`Git Octopus: ${isFetch ? 'fetched from remotes.' : 'pushed to remote.'}`
					);
					return true;
				} catch (err) {
					vscode.window.showErrorMessage(
						`Git Octopus: ${err instanceof Error ? err.message : String(err)}`
					);
					return false;
				}
			}
		);
	}
}
