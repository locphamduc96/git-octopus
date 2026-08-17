import * as vscode from 'vscode';
import type { RepoActionMessage, SequencerActionMessage } from '@git-octopus/shared';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';
import { friendlyGitError } from '../../core/git/friendlyGitError.js';
import { getRepoState } from '../../core/git/gitService.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { parseRemoteHosts } from '../../core/git/remoteHosts.js';
import { pathExists } from '../fs/pathExists.js';

/** One redacted, classified line for a network failure — never the raw text. */
function networkError(err: unknown): string {
	const raw = redactSecrets(err instanceof Error ? err.message : String(err));
	return friendlyGitError(raw) ?? raw;
}

/** Runs repository-wide network actions (fetch / push) with progress and error reporting. */
export class RepoActionService {
	public constructor(private readonly executor: GitExecutor) {}

	/**
	 * The auth context a network command declares before it may prompt: the hosts come from the
	 * repository's own remotes, resolved here — before the spawn — never from prompt text.
	 */
	private async authFor(operation: string, cwd: string): Promise<GitAuthRequest> {
		let listHosts: string[] = [];
		try {
			listHosts = parseRemoteHosts(await this.executor.run(['remote', '-v'], cwd));
		} catch {
			// No remotes readable: the command itself will say so; auth context stays empty.
		}
		return { operation, listHosts };
	}

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
			pullRebase: ['pull', '--rebase'],
			pullFf: ['pull', '--ff-only'],
		};
		const mapTitle: Record<RepoActionMessage['action'], string> = {
			fetch: 'Git Octopus: fetching…',
			push: 'Git Octopus: pushing…',
			pushForce: 'Git Octopus: force pushing…',
			pull: 'Git Octopus: pulling…',
			pullRebase: 'Git Octopus: pulling (rebase)…',
			pullFf: 'Git Octopus: pulling (fast-forward only)…',
		};
		const mapDone: Record<RepoActionMessage['action'], string> = {
			fetch: 'fetched from remotes.',
			push: 'pushed to remote.',
			pushForce: 'force pushed to remote.',
			pull: 'pulled from remote.',
			pullRebase: 'pulled with rebase.',
			pullFf: 'fast-forwarded from remote.',
		};

		return vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: mapTitle[message.action] },
			async () => {
				const auth = await this.authFor(message.action, cwd);
				try {
					await this.executor.run(mapArgs[message.action], cwd, undefined, auth);
					vscode.window.showInformationMessage(`Git Octopus: ${mapDone[message.action]}`);
					return true;
				} catch (err) {
					const detail = redactSecrets(err instanceof Error ? err.message : String(err));
					if (message.action === 'push' && detail.includes('no upstream branch')) {
						return this.publish(cwd, detail, auth);
					}
					if (
						message.action === 'push' &&
						(detail.includes('non-fast-forward') || detail.includes('fetch first'))
					) {
						return this.offerForcePush(cwd, detail, auth);
					}
					vscode.window.showErrorMessage(`Git Octopus: ${friendlyGitError(detail) ?? detail}`);
					return false;
				}
			}
		);
	}

	/**
	 * Drive the paused operation (rebase / merge / cherry-pick / revert) the banner reported.
	 * Always returns true: whatever happened, the graph should re-read the repository state.
	 */
	public async runSequencer(message: SequencerActionMessage, cwd: string): Promise<boolean> {
		const state = await getRepoState(this.executor, cwd, pathExists);
		if (!state) return true; // Stale banner — the refresh will clear it.
		const mapCommand = {
			rebasing: 'rebase',
			merging: 'merge',
			cherryPicking: 'cherry-pick',
			reverting: 'revert',
		} as const;
		const command = mapCommand[state];
		if (message.action === 'skip' && state === 'merging') return true;
		if (message.action === 'abort') {
			const pick = await vscode.window.showWarningMessage(
				`Abort the ${command} in progress? The repository goes back to where it was before it started.`,
				{ modal: true },
				'Abort'
			);
			if (pick !== 'Abort') return false;
		} else if (message.action === 'skip') {
			const pick = await vscode.window.showWarningMessage(
				`Skip the current commit? Its changes are left out of the ${command}.`,
				{ modal: true },
				'Skip'
			);
			if (pick !== 'Skip') return false;
		}
		try {
			// `core.editor=true` accepts git's prepared commit message instead of opening an editor
			// this UI could never show.
			await this.executor.run(['-c', 'core.editor=true', command, `--${message.action}`], cwd);
			vscode.window.showInformationMessage(`Git Octopus: ${command} ${message.action} done.`);
		} catch (err) {
			vscode.window.showErrorMessage(
				`Git Octopus: ${err instanceof Error ? err.message : String(err)}`
			);
		}
		return true;
	}

	/**
	 * A rejected non-fast-forward push usually follows a history rewrite (squash, rebase, amend), so
	 * offer the force push here instead of making the user find the separate button. `--force-with-lease`
	 * still refuses if the remote grew commits this repository has not seen, so someone else's work
	 * cannot be silently overwritten.
	 */
	private async offerForcePush(
		cwd: string,
		detail: string,
		auth: GitAuthRequest
	): Promise<boolean> {
		const pick = await vscode.window.showWarningMessage(
			'Push was rejected: the remote branch has diverged — usually because history was ' +
				'rewritten locally (squash, rebase, amend). Force push (with lease) to overwrite it?',
			{ modal: true },
			'Force Push'
		);
		if (pick !== 'Force Push') {
			vscode.window.showErrorMessage(`Git Octopus: ${detail}`);
			return false;
		}
		try {
			await this.executor.run(['push', '--force-with-lease'], cwd, undefined, auth);
			vscode.window.showInformationMessage('Git Octopus: force pushed to remote.');
			return true;
		} catch (err) {
			vscode.window.showErrorMessage(`Git Octopus: ${networkError(err)}`);
			return false;
		}
	}

	/**
	 * A branch that has never been pushed has no upstream, so plain `git push` refuses. That is the
	 * one push failure with an obvious next step, so offer it rather than just reporting the error.
	 */
	private async publish(cwd: string, detail: string, auth: GitAuthRequest): Promise<boolean> {
		let branch: string;
		try {
			branch = (await this.executor.run(['symbolic-ref', '--short', 'HEAD'], cwd)).trim();
		} catch {
			vscode.window.showErrorMessage(`Git Octopus: ${detail}`);
			return false;
		}
		const pick = await vscode.window.showWarningMessage(
			`${branch} has no upstream branch. Publish it to origin?`,
			{ modal: true },
			'Publish'
		);
		if (pick !== 'Publish') return false;
		try {
			await this.executor.run(['push', '--set-upstream', 'origin', branch], cwd, undefined, auth);
			vscode.window.showInformationMessage(`Git Octopus: published ${branch} to origin.`);
			return true;
		} catch (err) {
			vscode.window.showErrorMessage(`Git Octopus: ${networkError(err)}`);
			return false;
		}
	}
}
