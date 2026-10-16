import type {
	BranchActionMessage,
	CommitActionId,
	CommitActionMessage,
	MultiCommitActionMessage,
} from '@git-octopus/shared';
import { remoteRefLabel } from '@git-octopus/shared';

/**
 * What the Undo button calls each action.
 *
 * A total `Record` rather than a `switch` with a default: adding an action id without deciding what
 * undoing it is called then fails the build, instead of shipping a button that says "undo action".
 * Ids that cannot change a ref still need an entry — they are simply never recorded, because
 * nothing moved.
 */
const mapCommitLabels: Record<CommitActionId, string> = {
	checkout: 'checkout of commit',
	createBranch: 'branch created at',
	merge: 'merge of',
	rebase: 'rebase onto',
	cherryPick: 'cherry-pick of',
	revert: 'revert of',
	reword: 'reword of',
	resetSoft: 'soft reset to',
	resetMixed: 'mixed reset to',
	resetHard: 'hard reset to',
	addTag: 'tag added at',
	deleteTag: 'tag deletion',
	pushTag: 'tag push',
	deleteRemoteTag: 'remote tag deletion',
	openOnRemote: 'open on remote',
	copyRemoteUrl: 'copy remote URL',
	deleteBranch: 'deletion of branch',
	renameBranch: 'rename of branch',
	setUpstream: 'upstream change of',
	unsetUpstream: 'upstream removal of',
	checkoutBranch: 'checkout of',
	checkoutRemote: 'checkout of',
	checkoutPrevious: 'checkout of previous branch',
	deleteRemoteBranch: 'remote branch deletion',
	fetchIntoLocal: 'fetch into',
	pushBranch: 'push of',
	stashApply: 'stash apply',
	stashPop: 'stash pop',
	stashDrop: 'stash drop',
	stashBranch: 'branch from stash',
	copyHash: 'copy hash',
	copySubject: 'copy subject',
	copyRefName: 'copy ref name',
};

/** The ref an action was aimed at, in the form the user pointed at it. */
function subjectOf(message: CommitActionMessage): string {
	const remote = message.remoteBranches[0];
	return (
		message.branches[0] ??
		message.tags?.[0] ??
		(remote ? remoteRefLabel(remote) : undefined) ??
		message.hash.slice(0, 7)
	);
}

export function commitActionLabel(message: CommitActionMessage): string {
	return `${mapCommitLabels[message.action]} ${subjectOf(message)}`.trim();
}

export function branchActionLabel(message: BranchActionMessage): string {
	const source = message.sourceLabel || message.source;
	switch (message.action) {
		case 'mergeInto':
			return `merge of ${source} into ${message.target}`;
		case 'rebaseOnto':
			return `rebase of ${source} onto ${message.target}`;
		case 'fastForward':
			return `fast-forward of ${message.target} to ${source}`;
		case 'resetTo':
			return `reset of ${message.target} to ${source}`;
		case 'pushTo':
			return `push of ${source} to ${message.targetRemote ?? ''}/${message.target}`;
	}
}

/** Squash arrives on its own message type, so it gets its own label rather than a fourth verb. */
export function squashLabel(count: number): string {
	return `squash of ${count} ${count === 1 ? 'commit' : 'commits'}`;
}

export function multiActionLabel(message: MultiCommitActionMessage): string {
	const count = message.hashes.length;
	const plural = count === 1 ? 'commit' : 'commits';
	const mapVerbs: Record<MultiCommitActionMessage['action'], string> = {
		drop: 'drop',
		cherryPick: 'cherry-pick',
		revert: 'revert',
		rebaseRange: 'replay',
	};
	return `${mapVerbs[message.action]} of ${count} ${plural}`;
}
