/**
 * Host ↔ webview message protocol.
 * P1: commit graph. P2: commit details, diffs, commit actions. P3: working tree.
 */
import type { Commit, CommitDetails, WorkingTreeStatus } from '../model/index.js';

export interface ReadyMessage {
	type: 'ready';
}

export interface LoadCommitsMessage {
	type: 'loadCommits';
	limit: number;
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

export type CommitActionId =
	| 'checkout'
	| 'createBranch'
	| 'merge'
	| 'deleteBranch'
	| 'copyHash'
	| 'copySubject';

export interface CommitActionMessage {
	type: 'commitAction';
	action: CommitActionId;
	hash: string;
	subject: string;
	/** Local branch names pointing at this commit (for the delete-branch action). */
	branches: string[];
}

export type WorkingTreeAction = 'stage' | 'unstage' | 'stageAll' | 'unstageAll' | 'commit';

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

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
	| ReadyMessage
	| LoadCommitsMessage
	| LoadCommitDetailsMessage
	| OpenDiffMessage
	| CommitActionMessage
	| WorkingTreeActionMessage
	| OpenWorkingDiffMessage;

export interface CommitsMessage {
	type: 'commits';
	repoName: string | null;
	commits: Commit[];
	working: WorkingTreeStatus | null;
}

export interface CommitDetailsMessage {
	type: 'commitDetails';
	details: CommitDetails;
}

export interface ErrorMessage {
	type: 'error';
	message: string;
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview = CommitsMessage | CommitDetailsMessage | ErrorMessage;
