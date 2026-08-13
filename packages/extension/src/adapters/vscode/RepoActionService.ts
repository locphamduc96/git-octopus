import * as vscode from 'vscode';
import type { RepoActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** Runs repository-wide network actions (fetch / push) with progress and error reporting. */
export class RepoActionService {
	public constructor(private readonly executor: GitExecutor) {}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(message: RepoActionMessage, cwd: string): Promise<boolean> {
		if (message.action === 'pushForce') {
			const pick = await vscode.window.showWarningMessage(
				'Force push (with lease)? This rewrites the remote branch.',
				{ modal: true },
				'Force Push'
			);
			if (pick !== 'Force Push') return false;
		}

		const mapArgs: Record<RepoActionMessage['action'], string[]> = {
			fetch: ['fetch', '--all', '--prune'],
			push: ['push'],
			pushForce: ['push', '--force-with-lease'],
			pull: ['pull'],
		};
		const mapTitle: Record<RepoActionMessage['action'], string> = {
			fetch: 'Git Octopus: fetching…',
			push: 'Git Octopus: pushing…',
			pushForce: 'Git Octopus: force pushing…',
			pull: 'Git Octopus: pulling…',
		};
		const mapDone: Record<RepoActionMessage['action'], string> = {
			fetch: 'fetched from remotes.',
			push: 'pushed to remote.',
			pushForce: 'force pushed to remote.',
			pull: 'pulled from remote.',
		};

		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: mapTitle[message.action] },
			async () => {
				try {
					await this.executor.run(mapArgs[message.action], cwd);
					vscode.window.showInformationMessage(`Git Octopus: ${mapDone[message.action]}`);
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
