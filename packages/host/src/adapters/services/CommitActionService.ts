import type { HostShell } from '../../app/ports/shell.js';
import type {
	BranchActionMessage,
	CommitActionMessage,
	MultiCommitActionMessage,
	CherryPickCommitsMessage,
	RemoteBranchRef,
	SquashCommitsMessage,
} from '@git-octopus/shared';
import { assertNever, remoteRefLabel, remoteRefPath } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';
import { showGitError } from './staleLockNotice.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { remoteCommitUrl } from '../../core/git/remoteUrl.js';
import { parseRemoteHosts } from '../../core/git/remoteHosts.js';
import { LIST_MERGE_OPTIONS, mergeArgs } from '../../core/git/mergePlan.js';
import { parseAheadBehind, planCheckout } from '../../core/git/checkoutPlan.js';
import { listCandidateRemotes } from '../../core/git/remoteOwnership.js';
import { HistoryRewriter } from './HistoryRewriter.js';

/** The subset of `CommitActionId` that `runStashAction` answers for. */
type StashActionId = 'stashApply' | 'stashPop' | 'stashDrop' | 'stashBranch';

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
	/** Minutes between scheduled fetches; 0 or absent means never. */
	autoFetchMinutes?: number;
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
		private readonly shell: HostShell,
		/**
		 * The saved **view settings** — not the whole preferences blob they are stored inside.
		 * Read per run, never cached, so a setting changed mid-session takes effect at once.
		 */
		private readonly readViewSettings: ViewSettingsReader = () => null
	) {
		this.rewriter = new HistoryRewriter(executor, shell);
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
				await this.shell.clipboard.writeText(message.hash);
				this.shell.notify.info('Git Octopus: commit hash copied.');
				return false;
			case 'copySubject':
				await this.shell.clipboard.writeText(message.subject);
				this.shell.notify.info('Git Octopus: subject copied.');
				return false;
			case 'copyRefName': {
				// Sent only from a ref-scoped menu, so each list holds at most the one ref that was
				// pointed at. Local name first: it is what the chip reads as when a branch has both.
				const remote = message.remoteBranches[0];
				const name =
					message.branches[0] ?? message.tags?.[0] ?? (remote ? remoteRefLabel(remote) : undefined);
				if (!name) return false;
				await this.shell.clipboard.writeText(name);
				this.shell.notify.info(`Git Octopus: ${name} copied.`);
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
				const listKind = await prompt.pickOptions({
					title: `Tag ${name} — choose type`,
					listOptions: [
						{ id: 'lightweight', label: 'Lightweight', picked: true },
						{ id: 'annotated', label: 'Annotated — carries a message' },
					],
				});
				if (!listKind) return false;
				if (listKind[0] === 'annotated') {
					const text = (
						await prompt.inputText({
							title: `Message for tag ${name}`,
							multiline: true,
							required: true,
						})
					)?.trim();
					if (!text) return false;
					return this.runGit(
						['tag', '-a', name, '-m', text, message.hash],
						cwd,
						`Created tag ${name}.`
					);
				}
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
				if (local) return this.checkoutLocal(local, message.remoteBranches[0] ?? null, cwd);
				// No local name in the payload: the user pointed at the remote ref itself.
				const remote = message.remoteBranches[0];
				if (!remote || !(await this.ownsRefUnambiguously(remote, cwd))) return false;
				return this.checkoutFromRemote(remote, cwd, prompt);
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
				return this.checkoutFromRemote(remote, cwd, prompt);
			}
			case 'pushBranch': {
				// The entry is built from a remote-scoped target, so the branch name arrives on the
				// remote ref rather than in `branches` — see `buildRefPayload`.
				const target = message.remoteBranches[0];
				if (!target || !(await this.ownsRefUnambiguously(target, cwd))) return false;
				const name = target.branch;
				if (!(await this.branchExists(name, cwd))) return false;
				// A fully-qualified refspec on both sides: pushing a branch that is not checked out
				// must never be resolved through HEAD, and `push.default` has no say in it.
				const track = (await this.upstreamOf(name, cwd)) ? [] : ['--set-upstream'];
				return this.runGit(
					[
						'push',
						...track,
						END_OF_OPTIONS,
						target.remote,
						`refs/heads/${name}:refs/heads/${name}`,
					],
					cwd,
					`Pushed ${name} to ${remoteRefLabel(target)}.`,
					await this.authFor('push', cwd)
				);
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
					this.shell.notify.error(
						'Git Octopus: could not build a web URL for this commit — the remote is missing or not a recognised host.'
					);
					return false;
				}
				if (message.action === 'openOnRemote') {
					await this.shell.open.openExternal(url);
				} else {
					await this.shell.clipboard.writeText(url);
					this.shell.notify.info('Git Octopus: commit URL copied.');
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
				return this.runStashAction(message.action, message, cwd, prompt);
			case 'deleteBranch':
				return this.deleteLocalBranch(message, cwd, prompt);
			case 'setUpstream': {
				const branch = await this.pickOne(
					prompt,
					message.branches,
					'Set the upstream of which branch?'
				);
				if (!branch) return false;
				const listRemoteRefs = (
					await this.executor.run(
						['for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
						cwd
					)
				)
					.split('\n')
					.filter((ref) => ref !== '' && !ref.endsWith('/HEAD'));
				if (listRemoteRefs.length === 0) {
					this.shell.notify.warn(
						'Git Octopus: there is no remote branch to track yet — fetch first.'
					);
					return false;
				}
				// The branch of the same name on each remote is the usual answer, so it leads the list.
				const sameName = (ref: string) => ref.slice(ref.indexOf('/') + 1) === branch;
				const listOrdered = [
					...listRemoteRefs.filter(sameName),
					...listRemoteRefs.filter((ref) => !sameName(ref)),
				];
				const [upstream] =
					(await prompt.pickOptions({
						title: `Upstream for ${branch}`,
						listOptions: listOrdered.map((ref) => ({ id: ref, label: ref })),
					})) ?? [];
				if (!upstream) return false;
				return this.runGit(
					['branch', `--set-upstream-to=${upstream}`, END_OF_OPTIONS, branch],
					cwd,
					`${branch} now tracks ${upstream}.`
				);
			}
			case 'unsetUpstream': {
				const branch = await this.pickOne(
					prompt,
					message.branches,
					'Unset the upstream of which branch?'
				);
				if (!branch) return false;
				return this.runGit(
					['branch', '--unset-upstream', END_OF_OPTIONS, branch],
					cwd,
					`${branch} no longer tracks a remote branch.`
				);
			}
			case 'renameBranch': {
				const branch = await this.pickOne(prompt, message.branches, 'Rename which branch?');
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
				const name = (
					await prompt.inputText({
						title: `Rename ${branch}`,
						prompt: 'New name for the branch.',
						value: branch,
						required: true,
					})
				)?.trim();
				if (!name || name === branch) return false;
				return this.runGit(['branch', '-m', branch, name], cwd, `Renamed ${branch} to ${name}.`);
			}
			default:
				assertNever(message.action);
				return false;
		}
	}

	/**
	 * `branch -d` first, always: the force variant is offered only after git itself has refused
	 * for the one reason force answers — commits that exist nowhere else. Any other failure is
	 * reported as-is, and the offer names the loss before the danger-styled button confirms it.
	 */
	private async deleteLocalBranch(
		message: CommitActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const branch = await this.pickOne(prompt, message.branches, 'Delete which branch?');
		if (!branch) return false;
		if (
			!(await this.proveRefStillAt(`refs/heads/${branch}`, `branch ${branch}`, message.hash, cwd))
		)
			return false;
		try {
			await this.executor.run(['branch', '-d', branch], cwd);
			this.shell.notify.info(`Git Octopus: Deleted branch ${branch}.`);
			return true;
		} catch (err) {
			const raw = redactSecrets(err instanceof Error ? err.message : String(err));
			if (!/not fully merged/i.test(raw)) {
				void showGitError(this.shell.notify, raw, cwd);
				return false;
			}
		}
		if (
			!(await this.confirm(
				prompt,
				`${branch} is not fully merged — commits that exist only on it will be lost. Force delete?`,
				'Force delete',
				true
			))
		)
			return false;
		return this.runGit(['branch', '-D', branch], cwd, `Deleted branch ${branch}.`);
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
				const onto = message.targetRemote
					? `refs/remotes/${message.targetRemote}/${target}`
					: target;
				const ontoLabel = message.targetRemote ? `${message.targetRemote}/${target}` : target;
				if (!(await this.confirm(prompt, `Rebase ${sourceLabel} onto ${ontoLabel}?`))) return false;
				if (source !== current) {
					if (!(await this.runGit(['checkout', source], cwd, `Checked out ${source}.`)))
						return false;
				}
				return this.runGit(['rebase', onto], cwd, `Rebased ${sourceLabel} onto ${ontoLabel}.`);
			}
			case 'resetTo': {
				if (message.targetRemote) return false;
				if (target === current) {
					// The branch is checked out, so the reset reaches the working tree: the mode is the
					// whole question, and hard is named for what it throws away.
					const [mode] =
						(await prompt.pickOptions({
							title: `Reset ${target} to ${sourceLabel}`,
							listOptions: [
								{ id: 'soft', label: 'Soft', description: 'keep every change, staged' },
								{ id: 'mixed', label: 'Mixed', description: 'keep every change, unstaged' },
								{ id: 'hard', label: 'Hard', description: 'discard uncommitted changes' },
							],
						})) ?? [];
					if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') return false;
					return this.runGit(
						['reset', `--${mode}`, source],
						cwd,
						`Reset ${target} to ${sourceLabel} (${mode}).`
					);
				}
				// Not checked out: only the ref moves. The commits it leaves stay in the undo record.
				if (
					!(await this.confirm(
						prompt,
						`Move ${target} to ${sourceLabel}? ${target} is not checked out, so only the branch moves — no file changes.`
					))
				)
					return false;
				return this.runGit(
					['branch', '-f', END_OF_OPTIONS, target, source],
					cwd,
					`Moved ${target} to ${sourceLabel}.`
				);
			}
			case 'pushTo': {
				const remote = message.targetRemote;
				// Only a local branch has anything of its own to push.
				if (!remote || source.startsWith('refs/remotes/')) return false;
				if (!(await this.confirm(prompt, `Push ${sourceLabel} to ${remote}/${target}?`)))
					return false;
				return this.runGit(
					['push', END_OF_OPTIONS, remote, `refs/heads/${source}:refs/heads/${target}`],
					cwd,
					`Pushed ${sourceLabel} to ${remote}/${target}.`,
					await this.authFor('push', cwd)
				);
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
				assertNever(message.action);
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

	/**
	 * Cherry-pick the editor's commits in its order. The list is proved first — real commits, none
	 * of them a merge, which would need a mainline to pick against — because the editor may have
	 * sat open while history was rewritten under it.
	 */
	public async cherryPickList(message: CherryPickCommitsMessage, cwd: string): Promise<boolean> {
		const listHashes = message.listHashes;
		if (listHashes.length === 0) return false;
		if (!listHashes.every((hash) => /^[0-9a-f]{7,64}$/.test(hash))) return false;
		try {
			const merges = (
				await this.executor.run(['rev-list', '--no-walk', '--merges', ...listHashes], cwd)
			).trim();
			if (merges !== '') {
				this.shell.notify.error(
					'Git Octopus: a merge commit cannot be cherry-picked from the list — leave it out.'
				);
				return false;
			}
		} catch {
			this.rewriter.staleSelectionError();
			return false;
		}
		const count = listHashes.length;
		const listFlags = [
			...(message.recordOrigin ? ['-x'] : []),
			...(message.noCommit ? ['--no-commit'] : []),
		];
		await this.runGit(
			['cherry-pick', ...listFlags, ...listHashes],
			cwd,
			message.noCommit
				? `Applied ${count} commit${count === 1 ? '' : 's'} to the index, uncommitted.`
				: `Cherry picked ${count} commit${count === 1 ? '' : 's'}.`
		);
		// A conflict stops the sequencer mid-run; the graph must refresh to show the banner.
		return true;
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
			case 'rebaseRange': {
				const guard = await this.rewriter.guardRewrite(newest, cwd);
				if (!guard) return false;
				// `rebase --onto <target> <oldest>^ <branch>` replays everything from `oldest` to the
				// branch tip. When the newest selected commit is not the tip, that is more commits than
				// the user picked — so the run has to reach the tip or the action means something else.
				if (guard.head !== newest) {
					this.shell.notify.error(
						`Git Octopus: the newest selected commit is not the tip of ${guard.branch} — ` +
							'a range rebase has to reach the tip.'
					);
					return false;
				}
				if (!(await this.rewriter.verifyFirstParentRun(message.hashes, cwd))) {
					this.rewriter.staleSelectionError();
					return false;
				}
				const target = await this.pickRebaseTarget(prompt, guard.branch, cwd);
				if (!target) return false;
				if (
					!(await this.confirm(
						prompt,
						`Replay ${count} commit${count === 1 ? '' : 's'} from ${guard.branch} onto ${target}? ` +
							`History on ${guard.branch} is rewritten.`
					))
				)
					return false;
				// The picker and the confirm are both windows the repository can move in.
				if (
					!this.rewriter.guardUnchanged(guard, await this.rewriter.guardRewrite(newest, cwd)) ||
					!(await this.rewriter.verifyFirstParentRun(message.hashes, cwd))
				) {
					this.rewriter.staleSelectionError();
					return false;
				}
				return this.rewriter.rebaseRangeOnto(
					cwd,
					guard.branch,
					`${oldest}^`,
					target,
					`Replayed ${count} commit${count === 1 ? '' : 's'} from ${guard.branch} onto ${target}.`
				);
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
			default: {
				const unhandled: never = message.action;
				void unhandled;
				return false;
			}
		}
	}

	/**
	 * Which branch to replay onto. Local branches only: replaying onto a remote-tracking ref would
	 * silently detach the relationship the user thinks they are rebasing against, and `origin/x` is
	 * a name for a commit here, not for a place to build on.
	 */
	private async pickRebaseTarget(
		prompt: UserPrompt,
		branch: string,
		cwd: string
	): Promise<string | null> {
		const output = await this.readGit(
			['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads'],
			cwd
		);
		const listOptions = output
			.split('\n')
			.map((line) => line.trim())
			.filter((name) => name !== '' && name !== branch)
			.map((name) => ({ id: name, label: name }));
		if (listOptions.length === 0) {
			this.shell.notify.error('Git Octopus: there is no other local branch to rebase onto.');
			return null;
		}
		const picked = await prompt.pickOptions({
			title: `Replay commits from ${branch} onto…`,
			listOptions,
		});
		return picked?.[0] ?? null;
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
	 * Check out `name`, closing the gap to the ref it tracks in the same step.
	 *
	 * The one place a checkout is decided, whichever gesture asked for it. The view only knows about
	 * branches drawn on the commit it is asking from, so it cannot tell a remote-only branch from
	 * one whose local copy has fallen behind and sits on an earlier row — git is asked here instead,
	 * and checking a branch out to leave it stale was never what the double-click meant.
	 *
	 * A diverged branch, or one that is only ahead, cannot be closed without choosing something, so
	 * it is only ever asked about — and only through `reconcile`, which the remote-ref gestures
	 * pass. Pointing at the local branch means "take me there", and someone keeping unpushed work on
	 * it must not be asked how to throw it away on every checkout.
	 */
	private async checkoutTracking(
		name: string,
		refPath: string,
		label: string,
		cwd: string,
		reconcile?: { prompt: UserPrompt; remote: string }
	): Promise<boolean> {
		const dirty = await this.isDirty(cwd);
		const plan = planCheckout({
			localExists: await this.branchExists(name, cwd),
			...(await this.aheadBehind(name, refPath, cwd)),
			dirty,
			autoFastForward: this.autoFastForwardEnabled(),
		});

		if (plan.kind === 'createTracking') {
			return this.runGit(['checkout', '-b', name, '--track', refPath], cwd, `Checked out ${name}.`);
		}
		if (plan.kind === 'checkoutOnly') {
			const note = plan.note ? ` — ${plan.note}` : '';
			return this.runGit(['checkout', name], cwd, `Checked out ${name}${note}.`);
		}
		if (plan.kind === 'checkoutDiverged') {
			if (!(await this.runGit(['checkout', name], cwd, `Checked out ${name} — ${plan.note}.`)))
				return false;
			if (!reconcile) return true;
			return this.reconcileDiverged(name, refPath, label, plan, dirty, cwd, reconcile.prompt);
		}
		if (plan.kind === 'checkoutAhead') {
			if (
				!(await this.runGit(
					['checkout', name],
					cwd,
					`Checked out ${name} — ${plan.note} of ${label}.`
				))
			)
				return false;
			if (!reconcile) return true;
			return this.reconcileAhead(name, refPath, label, plan.ahead, dirty, reconcile, cwd);
		}
		if (!(await this.runGit(['checkout', name], cwd, `Checked out ${name}.`))) return false;
		return this.runGit(
			['merge', '--ff-only', refPath],
			cwd,
			`Fast-forwarded ${name} ${plan.count} commit${plan.count === 1 ? '' : 's'} to ${label}.`
		);
	}

	/**
	 * Offer the ways a checked-out, diverged branch can meet the ref it tracks.
	 *
	 * Reset is the one that discards commits, so its label counts them, and it is withheld while
	 * the tree is dirty — `--hard` would take the uncommitted work too. Whatever runs here runs
	 * inside the caller's undo record, so the Undo button reverses it. Dismissing keeps the branch
	 * exactly where the checkout left it.
	 */
	private async reconcileDiverged(
		name: string,
		refPath: string,
		label: string,
		plan: { ahead: number; behind: number },
		dirty: boolean,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`;
		const listOptions = [
			{
				id: 'merge',
				label: `Merge ${label} into ${name}`,
				description: `keeps all ${commits(plan.ahead)} of yours; adds a merge commit`,
			},
			{
				id: 'rebase',
				label: `Rebase ${name} onto ${label}`,
				description: `replays your ${commits(plan.ahead)} on top of ${label}`,
			},
			...(dirty
				? []
				: [
						{
							id: 'reset',
							label: `Reset ${name} to ${label}`,
							description: `discards your ${commits(plan.ahead)} — undoable`,
						},
					]),
		];
		const [choice] =
			(await prompt.pickOptions({
				title: `${name} has diverged from ${label} — ${commits(plan.ahead)} ahead, ${commits(plan.behind)} behind`,
				listOptions,
			})) ?? [];
		if (choice === 'merge')
			return this.runGit(['merge', '--no-edit', refPath], cwd, `Merged ${label} into ${name}.`);
		if (choice === 'rebase')
			return this.runGit(['rebase', refPath], cwd, `Rebased ${name} onto ${label}.`);
		if (choice === 'reset')
			return this.runGit(
				['reset', '--hard', refPath],
				cwd,
				`Reset ${name} to ${label} — ${commits(plan.ahead)} discarded.`
			);
		return true;
	}

	/**
	 * Offer the two ways a branch that is only ahead of the ref it tracks can meet it.
	 *
	 * Checking out cannot: there is nothing to catch up on. Reset moves the branch back and so takes
	 * commits off it — the description says whether they still live on another ref or only in the
	 * undo record — and is withheld while the tree is dirty, as in `reconcileDiverged`. Push moves
	 * the remote up instead and loses nothing. Dismissing keeps the branch where the checkout left it.
	 */
	private async reconcileAhead(
		name: string,
		refPath: string,
		label: string,
		ahead: number,
		dirty: boolean,
		target: { prompt: UserPrompt; remote: string },
		cwd: string
	): Promise<boolean> {
		const count = `${ahead} commit${ahead === 1 ? '' : 's'}`;
		const keptOn = dirty ? null : await this.otherRefHolding(name, cwd);
		const listOptions = [
			...(dirty
				? []
				: [
						{
							id: 'reset',
							label: `Reset ${name} to ${label}`,
							description: keptOn
								? `drops ${count} from ${name} — still on ${keptOn}`
								: `drops ${count} from ${name} — only on this branch; undoable`,
						},
					]),
			{
				id: 'push',
				label: `Push ${name} to ${label}`,
				description: `${label} moves up to match — nothing is lost`,
			},
		];
		const [choice] =
			(await target.prompt.pickOptions({
				title: `${name} is ${count} ahead of ${label}`,
				listOptions,
			})) ?? [];
		if (choice === 'reset')
			return this.runGit(
				['reset', '--hard', refPath],
				cwd,
				`Reset ${name} to ${label} — ${count} dropped from ${name}.`
			);
		if (choice === 'push') {
			const track = (await this.upstreamOf(name, cwd)) ? [] : ['--set-upstream'];
			return this.runGit(
				['push', ...track, END_OF_OPTIONS, target.remote, `refs/heads/${name}:refs/heads/${name}`],
				cwd,
				`Pushed ${name} to ${label}.`,
				await this.authFor('push', cwd)
			);
		}
		return true;
	}

	/**
	 * Another ref that holds the tip of `name`, and with it every commit a reset would take off the
	 * branch — a local branch first, as the name people recognise. Null when only `name` holds it.
	 */
	private async otherRefHolding(name: string, cwd: string): Promise<string | null> {
		const own = `refs/heads/${name}`;
		try {
			const output = await this.executor.run(
				[
					'for-each-ref',
					'--format=%(refname)',
					'--contains',
					own,
					'refs/heads',
					'refs/remotes',
					'refs/tags',
				],
				cwd
			);
			const listRefs = output
				.split('\n')
				.filter((ref) => ref !== '' && ref !== own && !ref.endsWith('/HEAD'));
			const pick = listRefs.find((ref) => ref.startsWith('refs/heads/')) ?? listRefs[0];
			return pick ? pick.replace(/^refs\/(heads|remotes|tags)\//, '') : null;
		} catch {
			return null;
		}
	}

	/**
	 * Check out the branch behind a remote ref, whether or not a local one already exists.
	 * `reconcile` is passed by the gestures that pointed at the remote ref; see `checkoutTracking`.
	 */
	private async checkoutFromRemote(
		remote: RemoteBranchRef,
		cwd: string,
		reconcile?: UserPrompt
	): Promise<boolean> {
		// Never the `origin/main` short form in argv: a remote may be called `-evil`, and the ref
		// path can never be read as an option. It is also the only form that stays unambiguous
		// when the remote's own name contains a slash.
		return this.checkoutTracking(
			remote.branch,
			remoteRefPath(remote),
			remoteRefLabel(remote),
			cwd,
			reconcile && { prompt: reconcile, remote: remote.remote }
		);
	}

	/**
	 * Check out a local branch, measured against whatever it tracks.
	 *
	 * This is the gesture people actually use — double-click, or `Checkout <name>` — and until now
	 * it ran a bare `git checkout`, so a branch left behind yesterday was checked out still behind
	 * and nothing said so.
	 *
	 * The upstream is read from git rather than taken from the message: `buildRefPayload` narrows a
	 * local chip to its local name on purpose, and git's own `branch.<name>.merge` is the more
	 * accurate answer anyway. `fallback` covers a branch with a remote of the same name but no
	 * upstream ever configured — there is still a gap worth closing, and no config to read it from.
	 */
	private async checkoutLocal(
		name: string,
		fallback: RemoteBranchRef | null,
		cwd: string
	): Promise<boolean> {
		const upstream = await this.upstreamOf(name, cwd);
		if (upstream) return this.checkoutTracking(name, upstream.path, upstream.label, cwd);
		if (fallback && fallback.branch === name && (await this.ownsRefUnambiguously(fallback, cwd)))
			return this.checkoutFromRemote(fallback, cwd);
		return this.runGit(['checkout', name], cwd, `Checked out ${name}.`);
	}

	/**
	 * The ref a local branch tracks, as both the path git argv needs and the label a user reads.
	 *
	 * `%(upstream)` is asked for alongside `%(upstream:short)` so the remote never has to be split
	 * back out of `origin/main` — a split with no right answer once a remote's own name contains a
	 * slash.
	 */
	private async upstreamOf(
		name: string,
		cwd: string
	): Promise<{ path: string; label: string } | null> {
		const output = await this.readGit(
			['for-each-ref', '--format=%(upstream)%00%(upstream:short)', `refs/heads/${name}`],
			cwd
		);
		const [path, label] = output.split('\0');
		return path && label ? { path, label } : null;
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
			this.shell.notify.error('Git Octopus: nothing recorded to go back to.');
			return false;
		}
		const [head, branch, previous] = await Promise.all([
			this.readGit(['rev-parse', 'HEAD'], cwd),
			// Empty output means HEAD is detached, which is the state the banner was drawn for.
			this.readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, [1]),
			this.readGit(['rev-parse', '--abbrev-ref', '@{-1}'], cwd),
		]);
		if (head !== expected.headHash || branch !== '' || previous !== expected.previousBranch) {
			this.shell.notify.error(
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
		this.shell.notify.error(
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

	/**
	 * The action is passed separately, already narrowed to the four stash ids. `CommitActionMessage`
	 * is one interface rather than a union, so narrowing it in `run`'s switch does not narrow the
	 * message — and without that narrowing the `default` below would have to answer for every id
	 * `run` already handles instead of being a real exhaustiveness check.
	 */
	private async runStashAction(
		action: StashActionId,
		message: CommitActionMessage,
		cwd: string,
		prompt: UserPrompt
	): Promise<boolean> {
		const stash = message.stashName;
		if (!stash) return false;
		switch (action) {
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
				assertNever(action);
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
		this.shell.notify.error(
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
			this.shell.notify.info(`Git Octopus: ${successMessage}`);
			return true;
		} catch (err) {
			const raw = redactSecrets(err instanceof Error ? err.message : String(err));
			void showGitError(this.shell.notify, raw, cwd);
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
