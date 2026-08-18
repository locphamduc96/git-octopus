import * as vscode from 'vscode';
import type {
	BranchActionMessage,
	CommitActionMessage,
	MultiCommitActionMessage,
	RemoteBranchRef,
	SquashCommitsMessage,
} from '@git-octopus/shared';
import { remoteRefLabel, remoteRefPath } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';
import { friendlyGitError } from '../../core/git/friendlyGitError.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { remoteCommitUrl } from '../../core/git/remoteUrl.js';
import { parseRemoteHosts } from '../../core/git/remoteHosts.js';
import { LIST_MERGE_OPTIONS, mergeArgs } from '../../core/git/mergePlan.js';
import { parseAheadBehind, planCheckout } from '../../core/git/checkoutPlan.js';
import { listCandidateRemotes } from '../../core/git/remoteOwnership.js';
import { HistoryRewriter } from './HistoryRewriter.js';

/**
 * What to name a commit when merging or rebasing onto it.
 *
 * Git writes the merge message from whatever it was given, so passing the raw hash produces
 * `Merge commit '<40 chars>'`. Naming the branch instead yields the familiar
 * `Merge branch 'feature/x'`.
 */
function mergeableRef(message: CommitActionMessage): string {
	const remote = message.remoteBranches[0];
	return message.branches[0] ?? (remote ? remoteRefPath(remote) : message.hash);
}

/**
 * Separates a command's options from its positional arguments (git 2.24+).
 *
 * Needed wherever a name git let the user choose lands in argv: a remote may be called `-evil`,
 * which every option parser would otherwise read as flags.
 */
const END_OF_OPTIONS = '--end-of-options';

/**
 * The slice of the view's settings the host acts on. Only what is read here is named, so a new
 * setting the webview adds cannot quietly change what an action does.
 */
export interface HostViewSettings {
	autoFastForwardOnCheckout?: boolean;
}

/** Reads the saved view settings, or null when the user has never saved any. */
export type ViewSettingsReader = () => HostViewSettings | null;

/**
 * Dig the view settings out of the blob the webview persists.
 *
 * What is stored is the whole preferences object — `{ settings, columns, fileView, metaOpen }` —
 * so the settings sit one level in. Reading the outer object as if it were the settings answers
 * `undefined` for every flag, which for a boolean defaulting to on means the user cannot turn it
 * off.
 */
export function readHostViewSettings(stored: unknown): HostViewSettings | null {
	if (typeof stored !== 'object' || stored === null) return null;
	const settings = (stored as { settings?: unknown }).settings;
	if (typeof settings !== 'object' || settings === null) return null;
	return settings as HostViewSettings;
}

/**
 * Runs commit context-menu actions. Lives in the adapter layer because each action needs VS Code
 * UI (prompts, clipboard, notifications) and mutates the repository.
 */
export class CommitActionService {
	/** Guards and engine for squash / drop / reword — see {@link HistoryRewriter}. */
	private readonly rewriter: HistoryRewriter;

	public constructor(
		private readonly executor: GitExecutor,
		/**
		 * The saved **view settings** — not the whole preferences blob they are stored inside.
		 * Read per run, never cached, so a setting changed mid-session takes effect at once.
		 */
		private readonly readViewSettings: ViewSettingsReader = () => null
	) {
		this.rewriter = new HistoryRewriter(executor);
	}

	/** Returns true when the repository changed and the graph should refresh. */
	public async run(
		message: CommitActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
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
			case 'copyRefName': {
				// Sent only from a ref-scoped menu, so each list holds at most the one ref that was
				// pointed at. Local name first: it is what the chip reads as when a branch has both.
				const remote = message.remoteBranches[0];
				const name =
					message.branches[0] ?? message.tags?.[0] ?? (remote ? remoteRefLabel(remote) : undefined);
				if (!name) return false;
				await vscode.env.clipboard.writeText(name);
				vscode.window.showInformationMessage(`Git Octopus: ${name} copied.`);
				return false;
			}
			case 'checkout':
				if (!(await this.confirm(prompt, `Checkout commit ${short}? HEAD will be detached.`)))
					return false;
				return this.runGit(['checkout', message.hash], cwd, `Checked out ${short}.`);
			case 'createBranch': {
				const name = await this.askName(prompt, `Name for the new branch at ${short}`);
				if (!name) return false;
				// Checked out, not merely created. Naming a branch is how a user says where they are
				// about to work; leaving them standing on the old one makes every use of this two
				// steps, and the second one easy to forget.
				return this.runGit(
					['checkout', '-b', name, message.hash],
					cwd,
					`Created and checked out ${name}.`
				);
			}
			case 'addTag': {
				const name = await this.askName(prompt, `Name for the new tag at ${short}`);
				if (!name) return false;
				return this.runGit(['tag', name, message.hash], cwd, `Created tag ${name}.`);
			}
			case 'merge': {
				const listOptions = await prompt.pickOptions({
					title: `Merge ${short} — choose options`,
					multi: true,
					listOptions: LIST_MERGE_OPTIONS,
				});
				if (!listOptions) return false;
				return this.runGit(mergeArgs(mergeableRef(message), listOptions), cwd, `Merged ${short}.`);
			}
			case 'checkoutBranch': {
				const local = message.branches[0];
				if (local) return this.runGit(['checkout', local], cwd, `Checked out ${local}.`);
				const remote = message.remoteBranches[0];
				if (!remote || !(await this.ownsRefUnambiguously(remote, cwd))) return false;
				return this.checkoutFromRemote(remote, cwd);
			}
			case 'checkoutPrevious':
				return this.checkoutPrevious(message, cwd);
			case 'checkoutRemote': {
				const remote = await this.pickRemote(
					prompt,
					message.remoteBranches,
					'Checkout which remote branch?'
				);
				if (!remote || !(await this.ownsRefUnambiguously(remote, cwd))) return false;
				return this.checkoutFromRemote(remote, cwd);
			}
			case 'fetchIntoLocal': {
				const remote = await this.pickRemote(
					prompt,
					message.remoteBranches,
					'Fetch which remote branch into its local branch?'
				);
				if (!remote || !(await this.ownsRefUnambiguously(remote, cwd))) return false;
				const label = remoteRefLabel(remote);
				const listMode = await prompt.pickOptions({
					title: `Fetch ${label} into ${remote.branch}`,
					listOptions: [
						{ id: 'fetch', label: 'Fetch', description: 'Fast-forward only' },
						{ id: 'force', label: 'Force Fetch', description: 'Reset the local branch' },
					],
				});
				if (!listMode) return false;
				const refspec = `${listMode.includes('force') ? '+' : ''}${remote.branch}:${remote.branch}`;
				return this.runGit(
					// The remote's name is a positional argument, and git allows one starting with `-`.
					// `--end-of-options` is what stops `-evil` from being read as a bundle of flags;
					// it has to sit after this command's own options and before the positionals.
					['fetch', END_OF_OPTIONS, remote.remote, refspec],
					cwd,
					`Fetched ${label} into ${remote.branch}.`,
					await this.authFor('fetch', cwd)
				);
			}
			case 'deleteRemoteBranch': {
				const remote = await this.pickRemote(
					prompt,
					message.remoteBranches,
					'Delete which remote branch?'
				);
				if (!remote || !(await this.ownsRefUnambiguously(remote, cwd))) return false;
				const label = remoteRefLabel(remote);
				if (!(await this.proveRefStillAt(`refs/remotes/${label}`, label, message.hash, cwd)))
					return false;
				if (
					!(await this.confirm(prompt, `Delete ${label} from the remote? This cannot be undone.`))
				)
					return false;
				return this.runGit(
					['push', '--delete', END_OF_OPTIONS, remote.remote, remote.branch],
					cwd,
					`Deleted ${label}.`,
					await this.authFor('push', cwd)
				);
			}
			case 'rebase': {
				const onto = mergeableRef(message);
				if (!(await this.confirm(prompt, `Rebase the current branch onto ${onto}?`))) return false;
				return this.runGit(['rebase', onto], cwd, `Rebased onto ${onto}.`);
			}
			case 'cherryPick':
				if (!(await this.confirm(prompt, `Cherry pick commit ${short} onto the current branch?`)))
					return false;
				return this.runGit(['cherry-pick', message.hash], cwd, `Cherry picked ${short}.`);
			case 'reword': {
				const input = await prompt.inputText({
					title: `Reword ${short}`,
					prompt: 'New message for the commit — first line is the subject.',
					value: message.subject,
					multiline: true,
					required: true,
				});
				if (!input?.trim()) return false;
				const text = input.trim();
				const head = (await this.executor.run(['rev-parse', 'HEAD'], cwd)).trim();
				if (head === message.hash) {
					// `--only` with no paths: amend the message and nothing else — without it, whatever
					// the user happens to have staged would be swept into the reworded commit.
					// `--allow-empty` because a deliberately empty commit is still allowed a new message.
					return this.runGit(
						['commit', '--amend', '--only', '--allow-empty', '-m', text],
						cwd,
						`Reworded ${short}.`
					);
				}
				const guard = await this.rewriter.guardRewrite(message.hash, cwd);
				if (!guard) return false;
				if (
					!(await this.confirm(
						prompt,
						`Reword ${short}? History on ${guard.branch} will be rewritten.`
					))
				)
					return false;
				// The prompt can sit open while the repository moves on — prove the guards again at
				// the moment of action, on the same branch at the same tip.
				if (
					!this.rewriter.guardUnchanged(guard, await this.rewriter.guardRewrite(message.hash, cwd))
				) {
					this.rewriter.staleSelectionError();
					return false;
				}
				return this.rewriter.rewriteBelow(
					cwd,
					guard.branch,
					message.hash,
					message.hash,
					[['commit', '--amend', '--only', '--allow-empty', '-m', text]],
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
				const tag = await this.pickOne(prompt, message.tags ?? [], 'Delete which tag?');
				if (!tag) return false;
				if (!(await this.proveRefStillAt(`refs/tags/${tag}`, `tag ${tag}`, message.hash, cwd)))
					return false;
				if (!(await this.confirm(prompt, `Delete tag ${tag}? This only removes the local tag.`)))
					return false;
				return this.runGit(['tag', '-d', tag], cwd, `Deleted tag ${tag}.`);
			}
			case 'pushTag': {
				const tag = await this.pickOne(prompt, message.tags ?? [], 'Push which tag to origin?');
				if (!tag) return false;
				if (!(await this.proveRefStillAt(`refs/tags/${tag}`, `tag ${tag}`, message.hash, cwd)))
					return false;
				return this.runGit(
					['push', 'origin', `refs/tags/${tag}`],
					cwd,
					`Pushed tag ${tag} to origin.`,
					await this.authFor('push', cwd)
				);
			}
			case 'deleteRemoteTag': {
				const tag = await this.pickOne(prompt, message.tags ?? [], 'Delete which tag from origin?');
				if (!tag) return false;
				// The remote tag has no local ref of its own; the local one is what the menu drew and
				// what its label was taken from, so that is what has to still be true.
				if (!(await this.proveRefStillAt(`refs/tags/${tag}`, `tag ${tag}`, message.hash, cwd)))
					return false;
				if (!(await this.confirm(prompt, `Delete tag ${tag} from origin? This cannot be undone.`)))
					return false;
				return this.runGit(
					['push', 'origin', '--delete', `refs/tags/${tag}`],
					cwd,
					`Deleted tag ${tag} from origin.`,
					await this.authFor('push', cwd)
				);
			}
			case 'revert':
				if (!(await this.confirm(prompt, `Revert commit ${short}?`))) return false;
				return this.runGit(['revert', '--no-edit', message.hash], cwd, `Reverted ${short}.`);
			case 'resetSoft':
				return this.runGit(['reset', '--soft', message.hash], cwd, `Reset to ${short} (soft).`);
			case 'resetMixed':
				return this.runGit(['reset', '--mixed', message.hash], cwd, `Reset to ${short} (mixed).`);
			case 'resetHard': {
				// The only reset that throws work away, so it is the only one that asks first.
				if (
					!(await this.confirm(prompt, `Hard reset to ${short}? All uncommitted changes are lost.`))
				)
					return false;
				return this.runGit(['reset', '--hard', message.hash], cwd, `Reset to ${short} (hard).`);
			}
			case 'stashApply':
			case 'stashPop':
			case 'stashDrop':
			case 'stashBranch':
				return this.runStashAction(message, cwd, prompt);
			case 'deleteBranch': {
				const branch = await this.pickOne(prompt, message.branches, 'Delete which branch?');
				if (!branch) return false;
				if (
					!(await this.proveRefStillAt(
						`refs/heads/${branch}`,
						`branch ${branch}`,
						message.hash,
						cwd
					))
				)
					return false;
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
	public async runBranchAction(
		message: BranchActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const { source, target } = message;
		// What the user is asked about is the name they dragged; what git runs is the ref path.
		const sourceLabel = message.sourceLabel || source;
		const current = await this.rewriter.currentBranch(cwd);
		switch (message.action) {
			case 'mergeInto': {
				const listOptions = await prompt.pickOptions({
					title: `Merge ${sourceLabel} into ${target} — choose options`,
					multi: true,
					listOptions: LIST_MERGE_OPTIONS,
				});
				if (!listOptions) return false;
				if (target !== current) {
					if (
						!(await this.confirm(
							prompt,
							`Merge ${sourceLabel} into ${target}? ${target} will be checked out.`
						))
					)
						return false;
					if (!(await this.runGit(['checkout', target], cwd, `Checked out ${target}.`)))
						return false;
				}
				return this.runGit(mergeArgs(source, listOptions), cwd, `Merged ${source} into ${target}.`);
			}
			case 'rebaseOnto': {
				if (!(await this.confirm(prompt, `Rebase ${source} onto ${target}?`))) return false;
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
	public async squash(
		message: SquashCommitsMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const listHashes = message.hashes;
		if (listHashes.length < 2) return false;
		const newest = listHashes[0];
		const oldest = listHashes[listHashes.length - 1];
		const count = listHashes.length;

		const guard = await this.rewriter.guardRewrite(newest, cwd);
		if (!guard) return false;
		if (!(await this.rewriter.verifyFirstParentRun(listHashes, cwd))) {
			this.rewriter.staleSelectionError();
			return false;
		}

		const subject = await prompt.inputText({
			title: `Squash ${count} commits`,
			prompt: 'Message for the squashed commit — the original subjects are kept in the body.',
			value: message.subjects[message.subjects.length - 1] ?? '',
			multiline: true,
			required: true,
		});
		if (!subject?.trim()) return false;
		if (
			!(await this.confirm(
				prompt,
				`Squash ${count} commits into one? History on ${guard.branch} will be rewritten.`
			))
		)
			return false;
		// The message box and confirm can sit open for minutes — re-prove branch, tip and the
		// exact run right before the rewrite, against whatever the repository has become since.
		if (
			!this.rewriter.guardUnchanged(guard, await this.rewriter.guardRewrite(newest, cwd)) ||
			!(await this.rewriter.verifyFirstParentRun(listHashes, cwd))
		) {
			this.rewriter.staleSelectionError();
			return false;
		}

		// The original subjects go into the body, oldest first, so nothing is lost to the rewrite.
		const body = message.subjects.slice().reverse().join('\n');
		return this.rewriter.rewriteBelow(
			cwd,
			guard.branch,
			newest,
			newest,
			[
				['reset', '--soft', `${oldest}^`],
				['commit', '-m', subject.trim(), '-m', body],
			],
			`Squashed ${count} commits on ${guard.branch}.`
		);
	}

	/** Act on a multi-selected run of commits (newest → oldest). */
	public async runMulti(
		message: MultiCommitActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const count = message.hashes.length;
		if (count === 0) return false;
		const newest = message.hashes[0];
		const oldest = message.hashes[count - 1];
		switch (message.action) {
			case 'cherryPick': {
				if (!(await this.confirm(prompt, `Cherry pick ${count} commits onto the current branch?`)))
					return false;
				// Oldest first, so the picks apply in their original order.
				const listOldFirst = [...message.hashes].reverse();
				await this.runGit(['cherry-pick', ...listOldFirst], cwd, `Cherry picked ${count} commits.`);
				// A conflict stops the sequencer mid-run; the graph must refresh to show the banner.
				return true;
			}
			case 'revert': {
				if (!(await this.confirm(prompt, `Revert ${count} commits?`))) return false;
				await this.runGit(
					['revert', '--no-edit', ...message.hashes],
					cwd,
					`Reverted ${count} commits.`
				);
				return true;
			}
			case 'drop': {
				const guard = await this.rewriter.guardRewrite(newest, cwd);
				if (!guard) return false;
				if (!(await this.rewriter.verifyFirstParentRun(message.hashes, cwd))) {
					this.rewriter.staleSelectionError();
					return false;
				}
				if (
					!(await this.confirm(
						prompt,
						`Drop ${count} commits? Their changes are lost and history on ${guard.branch} is rewritten.`
					))
				)
					return false;
				// Same re-proof as squash: the confirm dialog is a window the repository can move in.
				if (
					!this.rewriter.guardUnchanged(guard, await this.rewriter.guardRewrite(newest, cwd)) ||
					!(await this.rewriter.verifyFirstParentRun(message.hashes, cwd))
				) {
					this.rewriter.staleSelectionError();
					return false;
				}
				return this.rewriter.rewriteBelow(
					cwd,
					guard.branch,
					`${oldest}^`,
					newest,
					[],
					`Dropped ${count} commits on ${guard.branch}.`
				);
			}
			default:
				return false;
		}
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

	/**
	 * Check out the branch behind a remote ref, whether or not a local one already exists.
	 *
	 * The view only knows about branches drawn on the commit it is asking from, so it cannot tell a
	 * remote-only branch from one whose local copy has fallen behind and sits on an earlier row.
	 * Git is asked here instead, and a branch that has only fallen behind is brought up to date in
	 * the same step — checking it out and leaving it stale was never what the double-click meant.
	 */
	private async checkoutFromRemote(remote: RemoteBranchRef, cwd: string): Promise<boolean> {
		const name = remote.branch;
		// Never the `origin/main` short form in argv: a remote may be called `-evil`, and the ref
		// path can never be read as an option. It is also the only form that stays unambiguous
		// when the remote's own name contains a slash.
		const refPath = remoteRefPath(remote);
		const label = remoteRefLabel(remote);
		const plan = planCheckout({
			localExists: await this.branchExists(name, cwd),
			...(await this.aheadBehind(name, refPath, cwd)),
			dirty: await this.isDirty(cwd),
			autoFastForward: this.autoFastForwardEnabled(),
		});

		if (plan.kind === 'createTracking') {
			return this.runGit(['checkout', '-b', name, '--track', refPath], cwd, `Checked out ${name}.`);
		}
		if (plan.kind === 'checkoutOnly') {
			const note = plan.note ? ` — ${plan.note}` : '';
			return this.runGit(['checkout', name], cwd, `Checked out ${name}${note}.`);
		}
		if (!(await this.runGit(['checkout', name], cwd, `Checked out ${name}.`))) return false;
		return this.runGit(
			['merge', '--ff-only', refPath],
			cwd,
			`Fast-forwarded ${name} ${plan.count} commit${plan.count === 1 ? '' : 's'} to ${label}.`
		);
	}

	/**
	 * The user's **Fast-forward on checkout** setting, read fresh for every checkout.
	 *
	 * The stored blob is the whole preferences object the view saves — settings, columns, and the
	 * rest — so the flag lives one level in. Reading it from the top level silently answered
	 * `undefined` for a setting the user had turned off.
	 */
	private autoFastForwardEnabled(): boolean {
		return this.readViewSettings()?.autoFastForwardOnCheckout !== false;
	}

	/**
	 * Return to the branch the detached-HEAD banner named.
	 *
	 * `git checkout -` resolves `@{-1}` when it runs, not when the button was drawn, so a banner
	 * left open across a checkout made elsewhere would send the user somewhere its label never
	 * mentioned. Both halves of what it claimed are proved again here, immediately before acting;
	 * either having moved means the view is stale, and a refresh says more than a surprise.
	 */
	private async checkoutPrevious(message: CommitActionMessage, cwd: string): Promise<boolean> {
		const expected = message.expected;
		if (!expected) {
			vscode.window.showErrorMessage('Git Octopus: nothing recorded to go back to.');
			return false;
		}
		const [head, branch, previous] = await Promise.all([
			this.readGit(['rev-parse', 'HEAD'], cwd),
			// Empty output means HEAD is detached, which is the state the banner was drawn for.
			this.readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, [1]),
			this.readGit(['rev-parse', '--abbrev-ref', '@{-1}'], cwd),
		]);
		if (head !== expected.headHash || branch !== '' || previous !== expected.previousBranch) {
			vscode.window.showErrorMessage(
				`Git Octopus: the repository moved since that was shown — refusing to check out ${expected.previousBranch}.`
			);
			// Truthy so the caller refreshes: the view is what is wrong here, not the repository.
			return true;
		}
		return this.runGit(
			['checkout', END_OF_OPTIONS, expected.previousBranch],
			cwd,
			`Checked out ${expected.previousBranch}.`
		);
	}

	/**
	 * Whether this ref path belongs to exactly one configured remote — checked against git, not
	 * against the split the view sent.
	 *
	 * Remote names may contain slashes, so `refs/remotes/team/origin/main` can be `team/origin`'s
	 * `main` or `team`'s branch called `origin/main`. Both remotes' default refspecs write that one
	 * ref, so whichever fetched last owns it and the name alone cannot say which. Acting anyway
	 * would fetch from, or delete on, a remote the user did not point at.
	 */
	private async ownsRefUnambiguously(remote: RemoteBranchRef, cwd: string): Promise<boolean> {
		const listRemotes = await this.listRemoteNames(cwd);
		const listCandidates = listCandidateRemotes(remoteRefPath(remote), listRemotes);
		if (listCandidates.length <= 1) return true;
		vscode.window.showErrorMessage(
			`Git Octopus: ${remoteRefPath(remote)} could belong to either of these remotes — ` +
				`${listCandidates.join(' or ')} — so there is no telling which one to act on. ` +
				'Rename one of them, or use the terminal.'
		);
		return false;
	}

	private async listRemoteNames(cwd: string): Promise<string[]> {
		const output = await this.readGit(['remote'], cwd);
		return output
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '');
	}

	/** Run a read-only command, answering '' for the exit codes that mean "no such thing". */
	private async readGit(args: string[], cwd: string, listOkCodes?: number[]): Promise<string> {
		try {
			return (await this.executor.run(args, cwd, listOkCodes)).trim();
		} catch {
			return '';
		}
	}

	private async branchExists(name: string, cwd: string): Promise<boolean> {
		// `--verify --quiet` exits 1 for a ref that is not there, which is an answer, not a failure.
		const output = await this.executor.run(
			['rev-parse', '--verify', '--quiet', `refs/heads/${name}`],
			cwd,
			[1]
		);
		return output.trim() !== '';
	}

	private async aheadBehind(
		local: string,
		remote: string,
		cwd: string
	): Promise<{ ahead: number; behind: number }> {
		try {
			return parseAheadBehind(
				await this.executor.run(
					['rev-list', '--count', '--left-right', `${local}...${remote}`],
					cwd
				)
			);
		} catch {
			// No local branch yet, or no merge base — either way there is no gap to close.
			return { ahead: 0, behind: 0 };
		}
	}

	/**
	 * Whether the working tree holds anything the user has not committed.
	 *
	 * Untracked files count. `merge --ff-only` will refuse rather than overwrite one, so a tree
	 * the guard called clean could still turn a checkout into an error — and the setting promises
	 * the fast-forward never runs while there is uncommitted work, which an untracked file is.
	 * Ignored files stay out of it: `--porcelain` never lists them.
	 */
	private async isDirty(cwd: string): Promise<boolean> {
		try {
			const output = await this.executor.run(
				['status', '--porcelain', '--untracked-files=normal'],
				cwd
			);
			return output.trim() !== '';
		} catch {
			// Unreadable status is not proof of a clean tree; assume dirty and leave the branch alone.
			return true;
		}
	}

	/** Whether `target` is an ancestor of `source`, i.e. whether it can be fast-forwarded to it. */
	public canFastForward(source: string, target: string, cwd: string): Promise<boolean> {
		return this.rewriter.canFastForward(source, target, cwd);
	}

	private async runStashAction(
		message: CommitActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const stash = message.stashName;
		if (!stash) return false;
		switch (message.action) {
			case 'stashApply':
				if (!(await this.confirm(prompt, `Apply ${stash} to the working tree?`))) return false;
				return this.runGit(['stash', 'apply', stash], cwd, `Applied ${stash}.`);
			case 'stashPop':
				if (!(await this.confirm(prompt, `Pop ${stash} into the working tree?`))) return false;
				return this.runGit(['stash', 'pop', stash], cwd, `Popped ${stash}.`);
			case 'stashDrop':
				if (!(await this.confirm(prompt, `Drop ${stash}? This cannot be undone.`))) return false;
				return this.runGit(['stash', 'drop', stash], cwd, `Dropped ${stash}.`);
			case 'stashBranch': {
				const name = await this.askName(prompt, `Name for the new branch from ${stash}`);
				if (!name) return false;
				return this.runGit(['stash', 'branch', name, stash], cwd, `Created branch ${name}.`);
			}
			default:
				return false;
		}
	}

	/**
	 * Whether `ref` still points at the commit the menu was built over.
	 *
	 * A menu is a snapshot. It can sit open while a terminal moves a branch, force-moves a tag, or
	 * deletes and recreates one — and every ref-scoped action names its ref by name, so without this
	 * the delete would land on whatever the name means *now*. `message.hash` is empty for actions
	 * raised from the repository tree, which names a ref with no commit in mind; there is nothing to
	 * check against there, so those pass through.
	 */
	private async refStillAt(ref: string, hash: string, cwd: string): Promise<boolean> {
		if (!hash) return true;
		try {
			// `^{commit}` so an annotated tag is compared by the commit it names, the way the graph
			// drew it, rather than by the tag object's own hash.
			const resolved = await this.executor.run(
				['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
				cwd
			);
			return resolved.trim() === hash;
		} catch {
			return false;
		}
	}

	/** `refStillAt`, plus the message the user sees when it has moved. */
	private async proveRefStillAt(
		ref: string,
		label: string,
		hash: string,
		cwd: string
	): Promise<boolean> {
		if (await this.refStillAt(ref, hash, cwd)) return true;
		vscode.window.showErrorMessage(
			`Git Octopus: ${label} no longer points at ${hash.slice(0, 7)} — it moved or was deleted since the menu opened. Refresh and try again.`
		);
		return false;
	}

	private async pickOne(
		prompt: UserPrompt,
		listChoices: string[],
		title: string
	): Promise<string | undefined> {
		if (listChoices.length === 0) return undefined;
		if (listChoices.length === 1) return listChoices[0];
		const listSelected = await prompt.pickOptions({
			title,
			listOptions: listChoices.map((choice) => ({ id: choice, label: choice })),
		});
		return listSelected?.[0];
	}

	/** The same choice over remote-tracking branches, picked by label but returned whole. */
	private async pickRemote(
		prompt: UserPrompt,
		listChoices: RemoteBranchRef[],
		title: string
	): Promise<RemoteBranchRef | undefined> {
		if (listChoices.length === 0) return undefined;
		if (listChoices.length === 1) return listChoices[0];
		const listSelected = await prompt.pickOptions({
			title,
			listOptions: listChoices.map((choice) => ({
				id: remoteRefLabel(choice),
				label: remoteRefLabel(choice),
			})),
		});
		const picked = listSelected?.[0];
		return listChoices.find((choice) => remoteRefLabel(choice) === picked);
	}

	private async askName(prompt: UserPrompt, title: string): Promise<string | undefined> {
		const value = await prompt.inputText({ title, required: true });
		return value?.trim() || undefined;
	}

	private confirm(
		prompt: UserPrompt,
		message: string,
		confirmLabel = 'Yes',
		danger = false
	): Promise<boolean> {
		return prompt.confirm({ title: 'Git Octopus', message, confirmLabel, danger });
	}

	private async runGit(
		args: string[],
		cwd: string,
		successMessage: string,
		auth?: GitAuthRequest
	): Promise<boolean> {
		try {
			await this.executor.run(args, cwd, undefined, auth);
			vscode.window.showInformationMessage(`Git Octopus: ${successMessage}`);
			return true;
		} catch (err) {
			const raw = redactSecrets(err instanceof Error ? err.message : String(err));
			vscode.window.showErrorMessage(`Git Octopus: ${friendlyGitError(raw) ?? raw}`);
			return false;
		}
	}

	/** Auth context for a remote-touching action: hosts resolved from this repo's remotes. */
	private async authFor(operation: string, cwd: string): Promise<GitAuthRequest> {
		let listHosts: string[] = [];
		try {
			listHosts = parseRemoteHosts(await this.executor.run(['remote', '-v'], cwd));
		} catch {
			// No remotes readable — the network command itself will report the real problem.
		}
		return { operation, listHosts };
	}
}
