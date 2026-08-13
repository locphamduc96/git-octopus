/**
 * Host ↔ webview message protocol.
 * P1: commit graph. P2: commit details, diffs, commit actions. P3: working tree, repos & filters.
 */
import type { Commit, CommitDetails, FileChange, WorkingTreeStatus } from '../model/index.js';

/** A Git repository discovered in the workspace. */
export interface RepoInfo {
	path: string;
	name: string;
}

/** Filters and options applied when loading the graph. */
export interface GraphFilters {
	/** A specific branch to show, or null for "Show All". */
	branch: string | null;
	showRemoteBranches: boolean;
	/**
	 * Opt-in: derive Gravatar URLs from author emails. Enabling this means author email hashes
	 * are sent to gravatar.com when the images load.
	 */
	fetchAvatars?: boolean;
}

export interface ReadyMessage {
	type: 'ready';
}

export interface LoadCommitsMessage {
	type: 'loadCommits';
	limit: number;
	filters?: GraphFilters;
}

export interface SelectRepoMessage {
	type: 'selectRepo';
	path: string;
}

export interface LoadCommitDetailsMessage {
	type: 'loadCommitDetails';
	hash: string;
}

export interface OpenDiffMessage {
	type: 'openDiff';
	hash: string;
	path: string;
}

export interface LoadComparisonMessage {
	type: 'loadComparison';
	fromHash: string;
	toHash: string;
}

export interface OpenCompareDiffMessage {
	type: 'openCompareDiff';
	fromHash: string;
	toHash: string;
	path: string;
}

export type CommitActionId =
	| 'checkout'
	| 'createBranch'
	| 'merge'
	| 'rebase'
	| 'cherryPick'
	| 'revert'
	| 'reset'
	| 'addTag'
	| 'deleteBranch'
	| 'checkoutRemote'
	| 'deleteRemoteBranch'
	| 'fetchIntoLocal'
	| 'stashApply'
	| 'stashPop'
	| 'stashDrop'
	| 'stashBranch'
	| 'copyHash'
	| 'copySubject';

export interface CommitActionMessage {
	type: 'commitAction';
	action: CommitActionId;
	hash: string;
	subject: string;
	/** Local branch names pointing at this commit (for the delete-branch action). */
	branches: string[];
	/** Remote-tracking branch names at this commit, e.g. "origin/main". */
	remoteBranches: string[];
	/** Stash reference (e.g. "stash@{0}") when the commit is a stash. */
	stashName?: string;
}

export type WorkingTreeAction =
	| 'stage'
	| 'unstage'
	| 'stageAll'
	| 'unstageAll'
	| 'discard'
	| 'stash'
	| 'commit';

export type RepoActionId = 'fetch' | 'push' | 'pushForce' | 'pull';

export interface RepoActionMessage {
	type: 'repoAction';
	action: RepoActionId;
}

export interface WorkingTreeActionMessage {
	type: 'workingTreeAction';
	action: WorkingTreeAction;
	path?: string;
	message?: string;
}

export interface OpenWorkingDiffMessage {
	type: 'openWorkingDiff';
	path: string;
}

export interface OpenTerminalMessage {
	type: 'openTerminal';
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
	| ReadyMessage
	| LoadCommitsMessage
	| SelectRepoMessage
	| LoadCommitDetailsMessage
	| LoadComparisonMessage
	| OpenDiffMessage
	| OpenCompareDiffMessage
	| CommitActionMessage
	| WorkingTreeActionMessage
	| RepoActionMessage
	| OpenWorkingDiffMessage
	| OpenTerminalMessage;

export interface CommitsMessage {
	type: 'commits';
	commits: Commit[];
	working: WorkingTreeStatus | null;
	repos: RepoInfo[];
	activeRepo: string | null;
	repoName: string | null;
	/** Branch names available in the Branches dropdown (local first, then remote). */
	listBranches: string[];
	currentBranch: string | null;
	/** Commits the current branch is ahead of / behind its upstream. */
	ahead: number;
	behind: number;
}

export interface CommitDetailsMessage {
	type: 'commitDetails';
	details: CommitDetails;
}

export interface ComparisonMessage {
	type: 'comparison';
	fromHash: string;
	toHash: string;
	files: FileChange[];
}

export interface ErrorMessage {
	type: 'error';
	message: string;
	repos: RepoInfo[];
	activeRepo: string | null;
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
	| CommitsMessage
	| CommitDetailsMessage
	| ComparisonMessage
	| ErrorMessage;
