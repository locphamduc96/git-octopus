import type { HostShell } from '../../app/ports/shell.js';
import type { WorktreeActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { defaultWorktreePath, getWorktrees } from '../../core/git/worktrees.js';
import { showGitError } from './staleLockNotice.js';

/**
 * Manage the repository's worktrees. Every path the view names is checked against git's own list
 * first: only a listed worktree is opened or removed, never an arbitrary folder.
 */
export class WorktreeService {
	public constructor(
		private readonly executor: GitExecutor,
		private readonly shell: HostShell
	) {}

	/** Run one action; true when the repository changed and the graph should refresh. */
	public async run(
		message: WorktreeActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		switch (message.action) {
			case 'open':
				return this.open(message.path ?? '', cwd);
			case 'add':
				return this.add(message.branch?.trim() ?? '', message.path?.trim(), cwd, prompt);
			case 'remove':
				return this.remove(message.path ?? '', cwd, prompt);
			case 'prune':
				return this.git(['worktree', 'prune'], cwd, 'forgot the worktrees whose folders are gone.');
		}
	}

	private async listed(path: string, cwd: string) {
		return (await getWorktrees(this.executor, cwd)).find((worktree) => worktree.path === path);
	}

	private async open(path: string, cwd: string): Promise<boolean> {
		const worktree = await this.listed(path, cwd);
		if (!worktree || worktree.prunable) {
			void this.shell.notify.error('Git Octopus: that worktree is no longer there.');
			return false;
		}
		await this.shell.open.openFolderWindow(path);
		return false;
	}

	private async add(
		branch: string,
		askedPath: string | undefined,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		if (branch === '' || branch.startsWith('-')) return false;
		try {
			await this.executor.run(['check-ref-format', '--branch', branch], cwd);
		} catch {
			void this.shell.notify.error(`Git Octopus: "${branch}" is not a valid branch name.`);
			return false;
		}
		const exists = await this.executor
			.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd)
			.then(() => true)
			.catch(() => false);
		let path = askedPath ?? '';
		if (path === '') {
			const top = (await this.executor.run(['rev-parse', '--show-toplevel'], cwd)).trim();
			path =
				(
					await prompt.inputText({
						title: exists
							? `Create a worktree for ${branch}`
							: `Create a worktree with a new branch ${branch} from HEAD`,
						prompt: 'Folder for the worktree — it must not exist yet.',
						value: defaultWorktreePath(top, branch),
						required: true,
					})
				)?.trim() ?? '';
			if (path === '') return false;
		}
		// `--` keeps a path that starts with a dash from being read as an option.
		const args = exists
			? ['worktree', 'add', '--', path, branch]
			: ['worktree', 'add', '-b', branch, '--', path];
		return this.git(args, cwd, `created a worktree for ${branch} at ${path}.`);
	}

	private async remove(path: string, cwd: string, prompt: UserPrompt): Promise<boolean> {
		const worktree = await this.listed(path, cwd);
		if (!worktree) return false;
		if (worktree.isMain || worktree.isCurrent) {
			void this.shell.notify.error(
				`Git Octopus: ${worktree.isMain ? 'the main worktree' : 'the worktree this window has open'} cannot be removed.`
			);
			return false;
		}
		const confirmed = await prompt.confirm({
			title: 'Git Octopus',
			message: `Remove the worktree at ${path}? Its folder is deleted; ${
				worktree.branch
					? `the branch ${worktree.branch} stays.`
					: 'its commits stay in the repository.'
			}`,
			confirmLabel: 'Remove Worktree',
			danger: true,
		});
		if (!confirmed) return false;
		try {
			await this.executor.run(['worktree', 'remove', '--', path], cwd);
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			if (!/modified or untracked files|is dirty|use --force/i.test(text)) {
				void showGitError(this.shell.notify, text, cwd);
				return false;
			}
			const force = await prompt.confirm({
				title: 'Git Octopus',
				message: `The worktree at ${path} has changes that are not committed. Remove it anyway? Those changes are lost.`,
				confirmLabel: 'Remove and Lose Changes',
				danger: true,
			});
			if (!force) return false;
			return this.git(
				['worktree', 'remove', '--force', '--', path],
				cwd,
				`removed the worktree at ${path}.`
			);
		}
		this.shell.notify.info(`Git Octopus: removed the worktree at ${path}.`);
		return true;
	}

	private async git(args: string[], cwd: string, done: string): Promise<boolean> {
		try {
			await this.executor.run(args, cwd);
			this.shell.notify.info(`Git Octopus: ${done}`);
			return true;
		} catch (err) {
			void showGitError(this.shell.notify, err instanceof Error ? err.message : String(err), cwd);
			return false;
		}
	}
}
