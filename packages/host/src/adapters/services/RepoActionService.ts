import type { HostShell } from '../../app/ports/shell.js';
import type {
	RemoteActionMessage,
	RepoActionMessage,
	SequencerActionMessage,
} from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';
import { friendlyGitError } from '../../core/git/friendlyGitError.js';
import { showGitError } from './staleLockNotice.js';
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
	public constructor(
		private readonly executor: GitExecutor,
		private readonly shell: HostShell
	) {}

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
	public async run(message: RepoActionMessage, cwd: string, prompt: UserPrompt): Promise<boolean> {
		if (message.action === 'pushForce') {
			const confirmed = await prompt.confirm({
				title: 'Git Octopus',
				message: 'Force push (with lease)? This rewrites the remote branch.',
				confirmLabel: 'Force Push',
				danger: true,
			});
			if (!confirmed) return false;
		}

		const mapArgs: Record<RepoActionMessage['action'], string[]> = {
			fetch: ['fetch', '--all', '--prune'],
			push: ['push'],
			pushForce: ['push', '--force-with-lease'],
			pull: ['pull'],
			pullRebase: ['pull', '--rebase'],
			pullFf: ['pull', '--ff-only'],
			pullFfIfPossible: ['pull', '--ff', '--no-rebase'],
		};
		const mapTitle: Record<RepoActionMessage['action'], string> = {
			fetch: 'Git Octopus: fetching…',
			push: 'Git Octopus: pushing…',
			pushForce: 'Git Octopus: force pushing…',
			pull: 'Git Octopus: pulling…',
			pullRebase: 'Git Octopus: pulling (rebase)…',
			pullFf: 'Git Octopus: pulling (fast-forward only)…',
			pullFfIfPossible: 'Git Octopus: pulling (fast-forward if possible)…',
		};
		const mapDone: Record<RepoActionMessage['action'], string> = {
			fetch: 'fetched from remotes.',
			push: 'pushed to remote.',
			pushForce: 'force pushed to remote.',
			pull: 'pulled from remote.',
			pullRebase: 'pulled with rebase.',
			pullFf: 'fast-forwarded from remote.',
			pullFfIfPossible: 'pulled from remote.',
		};

		return this.shell.progress.run(mapTitle[message.action], async () => {
			const auth = await this.authFor(message.action, cwd);
			try {
				await this.executor.run(mapArgs[message.action], cwd, undefined, auth);
				this.shell.notify.info(`Git Octopus: ${mapDone[message.action]}`);
				return true;
			} catch (err) {
				const detail = redactSecrets(err instanceof Error ? err.message : String(err));
				if (message.action === 'push' && detail.includes('no upstream branch')) {
					return this.publish(cwd, detail, auth, prompt);
				}
				if (
					message.action === 'push' &&
					(detail.includes('non-fast-forward') || detail.includes('fetch first'))
				) {
					return this.offerForcePush(cwd, detail, auth, prompt);
				}
				void showGitError(this.shell.notify, detail, cwd);
				return false;
			}
		});
	}

	/**
	 * Drive the paused operation (rebase / merge / cherry-pick / revert) the banner reported.
	 * Always returns true: whatever happened, the graph should re-read the repository state.
	 */
	/**
	 * Add a remote and fetch it, or remove one. A fetch that fails after the add leaves the remote in
	 * place — the URL may need credentials or the network may be down, and the remote is still what
	 * the user asked for.
	 */
	public async runRemoteAction(
		message: RemoteActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const name = message.name.trim();
		if (name === '') return false;
		if (message.action === 'remove') {
			const confirmed = await prompt.confirm({
				title: 'Git Octopus',
				message: `Remove the remote ${name}? Only this clone forgets it: its remote-tracking branches leave the graph, and nothing on the server changes.`,
				confirmLabel: 'Remove Remote',
				danger: true,
			});
			if (!confirmed) return false;
			try {
				await this.executor.run(['remote', 'remove', name], cwd);
				this.shell.notify.info(`Git Octopus: removed the remote ${name}.`);
				return true;
			} catch (err) {
				void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd);
				return false;
			}
		}
		const url = message.url?.trim() ?? '';
		if (url === '') return false;
		try {
			await this.executor.run(['remote', 'add', name, url], cwd);
		} catch (err) {
			void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd);
			return false;
		}
		return this.shell.progress.run(`Git Octopus: fetching ${name}…`, async () => {
			try {
				await this.executor.run(['fetch', name], cwd, undefined, await this.authFor('fetch', cwd));
				this.shell.notify.info(`Git Octopus: added and fetched ${name}.`);
			} catch (err) {
				this.shell.notify.warn(
					`Git Octopus: added ${name}, but fetching it failed — ${networkError(err)}`
				);
			}
			return true;
		});
	}

	public async runSequencer(
		message: SequencerActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
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
			const confirmed = await prompt.confirm({
				title: 'Git Octopus',
				message: `Abort the ${command} in progress? The repository goes back to where it was before it started.`,
				confirmLabel: 'Abort',
				danger: true,
			});
			if (!confirmed) return false;
		} else if (message.action === 'skip') {
			const confirmed = await prompt.confirm({
				title: 'Git Octopus',
				message: `Skip the current commit? Its changes are left out of the ${command}.`,
				confirmLabel: 'Skip',
			});
			if (!confirmed) return false;
		}
		try {
			// `core.editor=true` accepts git's prepared commit message instead of opening an editor
			// this UI could never show.
			await this.executor.run(['-c', 'core.editor=true', command, `--${message.action}`], cwd);
			this.shell.notify.info(`Git Octopus: ${command} ${message.action} done.`);
		} catch (err) {
			this.shell.notify.error(`Git Octopus: ${err instanceof Error ? err.message : String(err)}`);
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
		auth: GitAuthRequest,
		prompt: UserPrompt
	): Promise<boolean> {
		const confirmed = await prompt.confirm({
			title: 'Git Octopus',
			message:
				'Push was rejected: the remote branch has diverged — usually because history was ' +
				'rewritten locally (squash, rebase, amend). Force push (with lease) to overwrite it?',
			confirmLabel: 'Force Push',
			danger: true,
		});
		if (!confirmed) {
			this.shell.notify.error(`Git Octopus: ${detail}`);
			return false;
		}
		try {
			await this.executor.run(['push', '--force-with-lease'], cwd, undefined, auth);
			this.shell.notify.info('Git Octopus: force pushed to remote.');
			return true;
		} catch (err) {
			this.shell.notify.error(`Git Octopus: ${networkError(err)}`);
			return false;
		}
	}

	/**
	 * A branch that has never been pushed has no upstream, so plain `git push` refuses. That is the
	 * one push failure with an obvious next step, so offer it rather than just reporting the error.
	 */
	private async publish(
		cwd: string,
		detail: string,
		auth: GitAuthRequest,
		prompt: UserPrompt
	): Promise<boolean> {
		let branch: string;
		try {
			branch = (await this.executor.run(['symbolic-ref', '--short', 'HEAD'], cwd)).trim();
		} catch {
			this.shell.notify.error(`Git Octopus: ${detail}`);
			return false;
		}
		const confirmed = await prompt.confirm({
			title: 'Git Octopus',
			message: `${branch} has no upstream branch. Publish it to origin?`,
			confirmLabel: 'Publish',
		});
		if (!confirmed) return false;
		try {
			await this.executor.run(['push', '--set-upstream', 'origin', branch], cwd, undefined, auth);
			this.shell.notify.info(`Git Octopus: published ${branch} to origin.`);
			return true;
		} catch (err) {
			this.shell.notify.error(`Git Octopus: ${networkError(err)}`);
			return false;
		}
	}
}
