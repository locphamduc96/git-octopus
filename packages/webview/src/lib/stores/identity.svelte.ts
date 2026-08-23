import type { GitIdentity, WorkingTreeAction, WorkspaceIdentityEntry } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { planCommitGuard } from '../commitGuard';
import { identityMismatch, listMatchedIdentities, matchIdentity } from '../identity';
import { planAutoApply } from '../identityAutoApply';
import type { RepoIdentityState } from '../viewSettings';
import { prefs } from './prefs.svelte';
import { session } from './session.svelte';

/** Who commits here, which accounts are saved, and the questions both of those raise. */

let repoIdentity = $state<RepoIdentityState | null>(null);
let listIdentities = $state<GitIdentity[]>([]);
let adding = $state(false);
/** Every workspace repository's effective identity, asked for each time settings open. */
let listWorkspaceIdentities = $state<WorkspaceIdentityEntry[]>([]);
/** The commit-time question: the user is about to commit with an email the remote disagrees with. */
let commitGuard = $state<{ suggested: GitIdentity; message?: string } | null>(null);
/**
 * A commit waiting for the identity switch it asked for. The host handles `identityAction` and
 * `workingTreeAction` independently, so posting both at once could commit under the old email; the
 * commit goes out only once an `identity` reply shows the switch has landed.
 */
let pendingCommitAwaitIdentity: { email: string; message?: string } | null = null;
/**
 * One attempt per repo-and-identity: a successful apply comes back as an identity message that no
 * longer asks for anything, but a *failed* one comes back unchanged — and without this the view
 * would retry the same doomed apply on every identity reply, forever.
 */
let lastAutoApplyKey = '';

/** Saved identity currently in use, mismatch warning, and the chip label they produce. */
const activeIdentity = $derived(matchIdentity(listIdentities, repoIdentity?.email ?? null));
const warningFor = $derived(
	repoIdentity
		? identityMismatch(listIdentities, repoIdentity.listRemoteUrls, repoIdentity.email)
		: null
);
const warning = $derived(
	warningFor
		? `This repository's remote suggests the "${warningFor.label}" identity (${warningFor.email}), but commits will use ${repoIdentity?.email ?? 'no email'}. Open settings to switch.`
		: null
);
const label = $derived(activeIdentity ? activeIdentity.label : (repoIdentity?.email ?? null));

function apply(next: GitIdentity): void {
	postToHost({ type: 'identityAction', action: 'apply', name: next.name, email: next.email });
}

function postCommit(message?: string): void {
	postToHost({
		type: 'workingTreeAction',
		repoPath: session.repoPath,
		action: 'commit',
		message,
	});
}

function maybeAutoApply(): void {
	if (!repoIdentity) return;
	const plan = planAutoApply({
		enabled: prefs.settings.autoApplyIdentity,
		hasLocalOverride: repoIdentity.hasLocalName || repoIdentity.hasLocalEmail,
		activeEmail: repoIdentity.email,
		listMatched: listMatchedIdentities(listIdentities, repoIdentity.listRemoteUrls),
	});
	if (plan.kind !== 'apply') return;
	const key = `${session.repoPath}|${plan.identity.email}`;
	if (key === lastAutoApplyKey) return;
	lastAutoApplyKey = key;
	apply(plan.identity);
	session.showNotice(`Auto-applied identity "${plan.identity.label}" to this repository.`);
}

onHostType('identity', (message) => {
	repoIdentity = {
		name: message.name,
		email: message.email,
		hasLocalName: message.hasLocalName,
		hasLocalEmail: message.hasLocalEmail,
		listRemoteUrls: message.listRemoteUrls,
		globalName: message.globalName,
		globalEmail: message.globalEmail,
	};
	listIdentities = message.listIdentities;
	if (pendingCommitAwaitIdentity) {
		const pending = pendingCommitAwaitIdentity;
		pendingCommitAwaitIdentity = null;
		if (message.email === pending.email) {
			postCommit(pending.message);
		} else {
			session.showNotice(
				'The identity switch did not take effect, so nothing was committed. Your message is still in the box.'
			);
		}
	}
	maybeAutoApply();
});

onHostType('workspaceIdentities', (message) => {
	listWorkspaceIdentities = message.listRepos;
});

onRepoReset(() => {
	listWorkspaceIdentities = [];
	commitGuard = null;
	pendingCommitAwaitIdentity = null;
});

export const identity = {
	get current(): RepoIdentityState | null {
		return repoIdentity;
	},
	get listIdentities(): GitIdentity[] {
		return listIdentities;
	},
	get listWorkspaceIdentities(): WorkspaceIdentityEntry[] {
		return listWorkspaceIdentities;
	},
	get warningFor(): GitIdentity | null {
		return warningFor;
	},
	get warning(): string | null {
		return warning;
	},
	get label(): string | null {
		return label;
	},
	get overridden(): boolean {
		return repoIdentity?.hasLocalName === true || repoIdentity?.hasLocalEmail === true;
	},
	get globalIdentity(): { name: string | null; email: string | null } | null {
		return repoIdentity ? { name: repoIdentity.globalName, email: repoIdentity.globalEmail } : null;
	},
	get adding(): boolean {
		return adding;
	},
	get commitGuard(): { suggested: GitIdentity; message?: string } | null {
		return commitGuard;
	},
	apply,
	clearOverride(): void {
		postToHost({ type: 'identityAction', action: 'clearOverride' });
	},
	openAdd(): void {
		adding = true;
	},
	closeAdd(): void {
		adding = false;
	},
	/** Adding from the account dropdown saves the identity and switches to it in one step. */
	add(next: GitIdentity): void {
		adding = false;
		const listNext = [...listIdentities, next];
		listIdentities = listNext;
		postToHost({
			type: 'identityAction',
			action: 'apply',
			name: next.name,
			email: next.email,
			listIdentities: listNext,
		});
	},
	save(listNext: GitIdentity[]): void {
		listIdentities = listNext;
		postToHost({ type: 'saveIdentities', listIdentities: listNext });
	},
	/** Asked for each time settings open: another window may have changed an account since. */
	loadWorkspaceIdentities(): void {
		postToHost({ type: 'loadWorkspaceIdentities' });
	},
	/**
	 * True when the commit was intercepted and the question is now on screen — the caller must not
	 * post it. Any other working-tree action passes straight through.
	 */
	askBeforeCommit(action: WorkingTreeAction, message?: string): boolean {
		const plan = planCommitGuard(action, warningFor);
		if (plan.kind !== 'ask') return false;
		commitGuard = { suggested: plan.suggested, message };
		return true;
	},
	answerCommitGuard(choice: string): void {
		if (!commitGuard) return;
		const { suggested, message } = commitGuard;
		commitGuard = null;
		if (choice === 'anyway') {
			postCommit(message);
			return;
		}
		pendingCommitAwaitIdentity = { email: suggested.email, message };
		apply(suggested);
	},
	dismissCommitGuard(): void {
		commitGuard = null;
	},
};
