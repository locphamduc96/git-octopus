import * as vscode from 'vscode';
import type {
	BranchActionMessage,
	CommitActionMessage,
	MultiCommitActionMessage,
	SquashCommitsMessage,
} from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { remoteCommitUrl } from '../../core/git/remoteUrl.js';
import { isFirstParentRun } from '../../core/git/rewriteGuards.js';

/**
 * What to name a commit when merging or rebasing onto it.
 *
 * Git writes the merge message from whatever it was given, so passing the raw hash produces
 * `Merge commit '<40 chars>'`. Naming the branch instead yields the familiar
 * `Merge branch 'feature/x'`.
 */
function mergeableRef(message: CommitActionMessage): string {
	return message.branches[0] ?? message.remoteBranches[0] ?? message.hash;
}

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
				const args = ['merge', mergeableRef(message)];
				if (options.some((option) => option.label === 'Squash commits')) args.push('--squash');
				else if (options.some((option) => option.label === 'No fast-forward')) args.push('--no-ff');
				if (options.some((option) => option.label === 'No commit')) args.push('--no-commit');
				return this.runGit(args, cwd, `Merged ${short}.`);
			}
			case 'checkoutBranch': {
				const local = message.branches[0];
				if (local) return this.runGit(['checkout', local], cwd, `Checked out ${local}.`);
				// Remote-only branch: create a local branch that tracks it.
				const remote = message.remoteBranches[0];
				if (!remote) return false;
				const name = remote.slice(remote.indexOf('/') + 1);
				return this.runGit(
					['checkout', '-b', name, '--track', remote],
					cwd,
					`Checked out ${name}.`
				);
			}
			case 'checkoutRemote': {
				const remote = await this.pickOne(message.remoteBranches, 'Checkout which remote branch?');
				if (!remote) return false;
				const local = remote.slice(remote.indexOf('/') + 1);
				return this.runGit(
					['checkout', '-b', local, '--track', remote],
					cwd,
					`Checked out ${local}.`
				);
			}
			case 'fetchIntoLocal': {
				const remote = await this.pickOne(
					message.remoteBranches,
					'Fetch which remote branch into its local branch?'
				);
				if (!remote) return false;
				const slash = remote.indexOf('/');
				const remoteName = remote.slice(0, slash);
				const branchName = remote.slice(slash + 1);
				const force = await vscode.window.showQuickPick(
					[
						{ label: 'Fetch', description: 'Fast-forward only', value: false },
						{ label: 'Force Fetch', description: 'Reset the local branch', value: true },
					],
					{ placeHolder: `Fetch ${remote} into ${branchName}` }
				);
				if (!force) return false;
				const refspec = `${force.value ? '+' : ''}${branchName}:${branchName}`;
				return this.runGit(
					['fetch', remoteName, refspec],
					cwd,
					`Fetched ${remote} into ${branchName}.`
				);
			}
			case 'deleteRemoteBranch': {
				const remote = await this.pickOne(message.remoteBranches, 'Delete which remote branch?');
				if (!remote) return false;
				const slash = remote.indexOf('/');
				const remoteName = remote.slice(0, slash);
				const branchName = remote.slice(slash + 1);
				if (!(await this.confirm(`Delete ${remote} from the remote? This cannot be undone.`)))
					return false;
				return this.runGit(['push', remoteName, '--delete', branchName], cwd, `Deleted ${remote}.`);
			}
			case 'rebase': {
				const onto = mergeableRef(message);
				if (!(await this.confirm(`Rebase the current branch onto ${onto}?`))) return false;
				return this.runGit(['rebase', onto], cwd, `Rebased onto ${onto}.`);
			}
			case 'cherryPick':
				if (!(await this.confirm(`Cherry pick commit ${short} onto the current branch?`)))
					return false;
				return this.runGit(['cherry-pick', message.hash], cwd, `Cherry picked ${short}.`);
			case 'reword': {
				const input = await vscode.window.showInputBox({
					prompt: `New message for commit ${short}`,
					value: message.subject,
					validateInput: (value) => (value.trim() === '' ? 'A message is required.' : undefined),
				});
				if (!input?.trim()) return false;
				const text = input.trim();
				const head = (await this.executor.run(['rev-parse', 'HEAD'], cwd)).trim();
				if (head === message.hash) {
					return this.runGit(['commit', '--amend', '-m', text], cwd, `Reworded ${short}.`);
				}
				const branch = await this.guardRewrite(message.hash, cwd);
				if (!branch) return false;
				if (!(await this.confirm(`Reword ${short}? History on ${branch} will be rewritten.`)))
					return false;
				return this.rewriteBelow(
					cwd,
					branch,
					message.hash,
					message.hash,
					[['commit', '--amend', '-m', text]],
					`Reworded ${short}.`
				);
			}
			case 'openOnRemote':
			case 'copyRemoteUrl': {
				const url = await this.commitRemoteUrl(message.hash, cwd);
				if (!url) {
					vscode.window.showErrorMessage(
						'Git Octopus: could not build a web URL for this commit — the remote is missing or not a recognised host.'
					);
					return false;
				}
				if (message.action === 'openOnRemote') {
					await vscode.env.openExternal(vscode.Uri.parse(url));
				} else {
					await vscode.env.clipboard.writeText(url);
					vscode.window.showInformationMessage('Git Octopus: commit URL copied.');
				}
				return false;
			}
			case 'deleteTag': {
				const tag = await this.pickOne(message.tags ?? [], 'Delete which tag?');
				if (!tag) return false;
				if (!(await this.confirm(`Delete tag ${tag}? This only removes the local tag.`)))
					return false;
				return this.runGit(['tag', '-d', tag], cwd, `Deleted tag ${tag}.`);
			}
			case 'pushTag': {
				const tag = await this.pickOne(message.tags ?? [], 'Push which tag to origin?');
				if (!tag) return false;
				return this.runGit(
					['push', 'origin', `refs/tags/${tag}`],
					cwd,
					`Pushed tag ${tag} to origin.`
				);
			}
			case 'deleteRemoteTag': {
				const tag = await this.pickOne(message.tags ?? [], 'Delete which tag from origin?');
				if (!tag) return false;
				if (!(await this.confirm(`Delete tag ${tag} from origin? This cannot be undone.`)))
					return false;
				return this.runGit(
					['push', 'origin', '--delete', `refs/tags/${tag}`],
					cwd,
					`Deleted tag ${tag} from origin.`
				);
			}
			case 'revert':
				if (!(await this.confirm(`Revert commit ${short}?`))) return false;
				return this.runGit(['revert', '--no-edit', message.hash], cwd, `Reverted ${short}.`);
			case 'resetSoft':
				return this.runGit(['reset', '--soft', message.hash], cwd, `Reset to ${short} (soft).`);
			case 'resetMixed':
				return this.runGit(['reset', '--mixed', message.hash], cwd, `Reset to ${short} (mixed).`);
			case 'resetHard': {
				// The only reset that throws work away, so it is the only one that asks first.
				if (!(await this.confirm(`Hard reset to ${short}? All uncommitted changes are lost.`)))
					return false;
				return this.runGit(['reset', '--hard', message.hash], cwd, `Reset to ${short} (hard).`);
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

	/**
	 * Act on one branch dropped onto another. Git can only merge or rebase into the branch it has
	 * checked out, so two of the three actions check the needed branch out first and leave the user
	 * standing there — the same trade the drag gesture implies elsewhere.
	 */
	public async runBranchAction(message: BranchActionMessage, cwd: string): Promise<boolean> {
		const { source, target } = message;
		const current = await this.currentBranch(cwd);
		switch (message.action) {
			case 'mergeInto': {
				const options = await vscode.window.showQuickPick(
					[
						{ label: 'No fast-forward', description: 'Always create a merge commit', picked: true },
						{ label: 'Squash commits', description: 'Combine into a single change' },
						{ label: 'No commit', description: 'Stage the merge without committing' },
					],
					{ canPickMany: true, placeHolder: `Merge ${source} into ${target} — choose options` }
				);
				if (!options) return false;
				if (target !== current) {
					if (
						!(await this.confirm(`Merge ${source} into ${target}? ${target} will be checked out.`))
					)
						return false;
					if (!(await this.runGit(['checkout', target], cwd, `Checked out ${target}.`)))
						return false;
				}
				const args = ['merge', source];
				if (options.some((option) => option.label === 'Squash commits')) args.push('--squash');
				else if (options.some((option) => option.label === 'No fast-forward')) args.push('--no-ff');
				if (options.some((option) => option.label === 'No commit')) args.push('--no-commit');
				return this.runGit(args, cwd, `Merged ${source} into ${target}.`);
			}
			case 'rebaseOnto': {
				if (!(await this.confirm(`Rebase ${source} onto ${target}?`))) return false;
				if (source !== current) {
					if (!(await this.runGit(['checkout', source], cwd, `Checked out ${source}.`)))
						return false;
				}
				return this.runGit(['rebase', target], cwd, `Rebased ${source} onto ${target}.`);
			}
			case 'fastForward': {
				// `fetch . <source>:<target>` moves a branch the user is not standing on; Git refuses
				// unless it really is a fast-forward, so no branch can be silently rewritten here.
				if (target === current) {
					return this.runGit(
						['merge', '--ff-only', source],
						cwd,
						`Fast-forwarded ${target} to ${source}.`
					);
				}
				return this.runGit(
					['fetch', '.', `${source}:${target}`],
					cwd,
					`Fast-forwarded ${target} to ${source}.`
				);
			}
			default:
				return false;
		}
	}

	/**
	 * Squash a contiguous run of commits (newest → oldest) into one commit on the current branch.
	 *
	 * The rewrite happens on a detached HEAD — `reset --soft` to the run's base stages the run's
	 * combined change, one commit captures it, and a final `rebase --onto` replays whatever sat
	 * above the run and moves the branch. The branch ref itself is only touched by that last step,
	 * so any earlier failure leaves it exactly where it was.
	 */
	public async squash(message: SquashCommitsMessage, cwd: string): Promise<boolean> {
		const listHashes = message.hashes;
		if (listHashes.length < 2) return false;
		const newest = listHashes[0];
		const oldest = listHashes[listHashes.length - 1];
		const count = listHashes.length;

		const branch = await this.guardRewrite(newest, cwd);
		if (!branch) return false;
		if (!(await this.verifyFirstParentRun(listHashes, cwd))) {
			this.staleSelectionError();
			return false;
		}

		const subject = await vscode.window.showInputBox({
			prompt: `Message for the squashed commit (${count} commits)`,
			value: message.subjects[message.subjects.length - 1] ?? '',
			validateInput: (input) => (input.trim() === '' ? 'A message is required.' : undefined),
		});
		if (!subject?.trim()) return false;
		if (
			!(await this.confirm(
				`Squash ${count} commits into one? History on ${branch} will be rewritten.`
			))
		)
			return false;

		// The original subjects go into the body, oldest first, so nothing is lost to the rewrite.
		const body = message.subjects.slice().reverse().join('\n');
		return this.rewriteBelow(
			cwd,
			branch,
			newest,
			newest,
			[
				['reset', '--soft', `${oldest}^`],
				['commit', '-m', subject.trim(), '-m', body],
			],
			`Squashed ${count} commits on ${branch}.`
		);
	}

	/** Act on a multi-selected run of commits (newest → oldest). */
	public async runMulti(message: MultiCommitActionMessage, cwd: string): Promise<boolean> {
		const count = message.hashes.length;
		if (count === 0) return false;
		const newest = message.hashes[0];
		const oldest = message.hashes[count - 1];
		switch (message.action) {
			case 'cherryPick': {
				if (!(await this.confirm(`Cherry pick ${count} commits onto the current branch?`)))
					return false;
				// Oldest first, so the picks apply in their original order.
				const listOldFirst = [...message.hashes].reverse();
				await this.runGit(['cherry-pick', ...listOldFirst], cwd, `Cherry picked ${count} commits.`);
				// A conflict stops the sequencer mid-run; the graph must refresh to show the banner.
				return true;
			}
			case 'revert': {
				if (!(await this.confirm(`Revert ${count} commits?`))) return false;
				await this.runGit(
					['revert', '--no-edit', ...message.hashes],
					cwd,
					`Reverted ${count} commits.`
				);
				return true;
			}
			case 'drop': {
				const branch = await this.guardRewrite(newest, cwd);
				if (!branch) return false;
				if (!(await this.verifyFirstParentRun(message.hashes, cwd))) {
					this.staleSelectionError();
					return false;
				}
				if (
					!(await this.confirm(
						`Drop ${count} commits? Their changes are lost and history on ${branch} is rewritten.`
					))
				)
					return false;
				return this.rewriteBelow(
					cwd,
					branch,
					`${oldest}^`,
					newest,
					[],
					`Dropped ${count} commits on ${branch}.`
				);
			}
			default:
				return false;
		}
	}

	/** See {@link isFirstParentRun} — the host's re-proof of a squash/drop selection. */
	private verifyFirstParentRun(listHashes: string[], cwd: string): Promise<boolean> {
		return isFirstParentRun(this.executor, listHashes, cwd);
	}

	private staleSelectionError(): void {
		vscode.window.showErrorMessage(
			'Git Octopus: the selection no longer matches the repository history — refresh the graph and try again.'
		);
	}

	/**
	 * Shared guards for every history rewrite below HEAD. Returns the branch to rewrite, or null
	 * (with the reason already shown) when the rewrite must not run.
	 */
	private async guardRewrite(newest: string, cwd: string): Promise<string | null> {
		const branch = await this.currentBranch(cwd);
		if (!branch) {
			vscode.window.showErrorMessage('Git Octopus: cannot rewrite history while HEAD is detached.');
			return null;
		}
		if (!(await this.canFastForward('HEAD', newest, cwd))) {
			vscode.window.showErrorMessage(
				`Git Octopus: the selected commits are not on ${branch} — check their branch out first.`
			);
			return null;
		}
		// Replaying a merge with plain rebase silently flattens it; refuse rather than rewrite topology.
		const merges = (
			await this.executor.run(['rev-list', '--merges', `${newest}..HEAD`], cwd)
		).trim();
		if (merges !== '') {
			vscode.window.showErrorMessage(
				'Git Octopus: there are merge commits above the selection — rewriting would flatten them.'
			);
			return null;
		}
		// A rewrite ends in a rebase, and rebase refuses a dirty tree; staged changes would also be
		// swept into any commit the rewrite makes.
		const dirty = (
			await this.executor.run(['status', '--porcelain', '--untracked-files=no'], cwd)
		).trim();
		if (dirty !== '') {
			vscode.window.showErrorMessage(
				'Git Octopus: commit or stash your changes before rewriting history.'
			);
			return null;
		}
		return branch;
	}

	/**
	 * The engine behind squash / drop / reword: detach at `detachAt`, run `listSteps` to shape the
	 * new tip, then replay everything above `oldTip` onto it and point the branch there.
	 *
	 * The branch ref is only touched by that final rebase, so any earlier failure leaves it exactly
	 * where it was; a failure inside the rebase is aborted and the branch checked out again.
	 */
	private async rewriteBelow(
		cwd: string,
		branch: string,
		detachAt: string,
		oldTip: string,
		listSteps: string[][],
		successMessage: string
	): Promise<boolean> {
		try {
			await this.executor.run(['checkout', '--detach', detachAt], cwd);
			for (const args of listSteps) await this.executor.run(args, cwd);
			const newTip = (await this.executor.run(['rev-parse', 'HEAD'], cwd)).trim();
			await this.executor.run(['rebase', '--onto', newTip, oldTip, branch], cwd);
			vscode.window.showInformationMessage(`Git Octopus: ${successMessage}`);
		} catch (err) {
			try {
				await this.executor.run(['rebase', '--abort'], cwd);
			} catch {
				// No rebase in progress — the failure came earlier.
			}
			try {
				await this.executor.run(['checkout', branch], cwd);
			} catch {
				// Leave HEAD as it stands; the error below tells the user where things stopped.
			}
			vscode.window.showErrorMessage(
				`Git Octopus: rewrite failed — ${err instanceof Error ? err.message : String(err)} ` +
					`Branch ${branch} was not changed.`
			);
		}
		// HEAD moved either way, so the graph needs a refresh even after a failure.
		return true;
	}

	/** The web URL of a commit on the `origin` remote (or the first remote), if recognisable. */
	private async commitRemoteUrl(hash: string, cwd: string): Promise<string | null> {
		let remoteUrl: string | null = null;
		try {
			remoteUrl = (await this.executor.run(['remote', 'get-url', 'origin'], cwd)).trim() || null;
		} catch {
			try {
				const first = (await this.executor.run(['remote'], cwd)).split('\n')[0]?.trim();
				if (first) {
					remoteUrl = (await this.executor.run(['remote', 'get-url', first], cwd)).trim() || null;
				}
			} catch {
				remoteUrl = null;
			}
		}
		return remoteUrl ? remoteCommitUrl(remoteUrl, hash) : null;
	}

	/** Whether `target` is an ancestor of `source`, i.e. whether it can be fast-forwarded to it. */
	public async canFastForward(source: string, target: string, cwd: string): Promise<boolean> {
		try {
			await this.executor.run(['merge-base', '--is-ancestor', target, source], cwd);
			return true;
		} catch {
			return false;
		}
	}

	private async currentBranch(cwd: string): Promise<string | null> {
		try {
			const name = (await this.executor.run(['symbolic-ref', '--short', 'HEAD'], cwd)).trim();
			return name === '' ? null : name;
		} catch {
			// Detached HEAD: no branch to compare against, so every action checks one out first.
			return null;
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

	private async pickOne(listChoices: string[], placeHolder: string): Promise<string | undefined> {
		if (listChoices.length === 0) return undefined;
		if (listChoices.length === 1) return listChoices[0];
		return vscode.window.showQuickPick(listChoices, { placeHolder });
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
