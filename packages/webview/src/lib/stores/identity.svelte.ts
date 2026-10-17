import type { GitIdentity, WorkingTreeAction, WorkspaceIdentityEntry } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { planCommitGuard } from '../commitGuard';
import {
	identityInitials,
	identityLine,
	identityMismatch,
	listMatchedIdentities,
	matchIdentity,
} from '../identity';
import { planAutoApply } from '../identityAutoApply';
import type { RepoIdentityState } from '../viewSettings';
import { prefs } from './prefs.svelte';
import { session } from './session.svelte';

/** Who commits here, which accounts are saved, and the questions both of those raise. */

let repoIdentity = $state<RepoIdentityState | null>(null);
/**
 * The repository the last `identity` reply was read from. `session.repoPath` is the view's own
 * answer to the same question, but it stays empty until the first `commits` reply lands — and an
 * identity action posted in that window would otherwise carry a stamp the host reads as a mismatch.
 */
let identityRepo = $state<string | null>(null);
let listIdentities = $state<GitIdentity[]>([]);
let adding = $state(false);
/** Every workspace repository's effective identity, asked for each time settings open. */
let listWorkspaceIdentities = $state<WorkspaceIdentityEntry[]>([]);
/** The commit-time question: the user is about to commit with an email the remote disagrees with. */
/** How a commit is to run, carried through the identity question so answering it loses nothing. */
export interface CommitOptions {
	noVerify?: boolean;
	pushAfter?: boolean;
}

let commitGuard = $state<{
	suggested: GitIdentity;
	message?: string;
	options?: CommitOptions;
} | null>(null);
/**
 * A commit waiting for the identity switch it asked for. The host handles `identityAction` and
 * `workingTreeAction` independently, so posting both at once could commit under the old email; the
 * commit goes out only once an `identity` reply shows the switch has landed.
 */
let pendingCommitAwaitIdentity: {
	email: string;
	message?: string;
	options?: CommitOptions;
} | null = null;
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
/** A saved identity's label, else the name git commits as, else its email. */
const label = $derived(
	activeIdentity ? activeIdentity.label : repoIdentity?.name || repoIdentity?.email || null
);

/** Which repository an identity action is stamped with — see `identityRepo`. */
function stampRepo(): string {
	return session.repoPath || (identityRepo ?? '');
}

function apply(next: GitIdentity): void {
	postToHost({
		type: 'identityAction',
		repoPath: stampRepo(),
		action: 'apply',
		name: next.name,
		email: next.email,
	});
}

function postCommit(message?: string, options: CommitOptions = {}): void {
	postToHost({
		type: 'workingTreeAction',
		repoPath: session.repoPath,
		action: 'commit',
		message,
		...options,
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
	const key = `${stampRepo()}|${plan.identity.email}`;
	if (key === lastAutoApplyKey) return;
	lastAutoApplyKey = key;
	apply(plan.identity);
	session.showNotice(`Auto-applied identity "${plan.identity.label}" to this repository.`);
}

onHostType('identity', (message) => {
	identityRepo = message.repoPath;
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
			postCommit(pending.message, pending.options);
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
	// The add dialog was opened over the repository that just went away. Every other dialog closes
	// on a repo switch; this one is a store field rather than a component prop, so it has to be
	// cleared here or it survives with a payload built for a repository nobody is looking at.
	adding = false;
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
	/** Letters for the avatar beside the label — from the person, not the saved identity's label. */
	get initials(): string {
		return identityInitials(repoIdentity?.name ?? null, repoIdentity?.email ?? null);
	},
	/** "Name <email>" exactly as commits will be stamped. */
	get line(): string {
		return identityLine(repoIdentity?.name ?? null, repoIdentity?.email ?? null);
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
		postToHost({ type: 'identityAction', repoPath: stampRepo(), action: 'clearOverride' });
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
			repoPath: stampRepo(),
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
	askBeforeCommit(action: WorkingTreeAction, message?: string, options?: CommitOptions): boolean {
		const plan = planCommitGuard(action, warningFor);
		if (plan.kind !== 'ask') return false;
		commitGuard = { suggested: plan.suggested, message, options };
		return true;
	},
	answerCommitGuard(choice: string): void {
		if (!commitGuard) return;
		const { suggested, message, options } = commitGuard;
		commitGuard = null;
		if (choice === 'anyway') {
			postCommit(message, options);
			return;
		}
		pendingCommitAwaitIdentity = { email: suggested.email, message, options };
		apply(suggested);
	},
	dismissCommitGuard(): void {
		commitGuard = null;
	},
};
