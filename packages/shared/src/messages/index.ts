/**
 * Host ↔ webview message protocol.
 * Phase 1: load the commit graph. Phase 2: commit details + open diffs.
 */
import type { Commit, CommitDetails } from '../model/index.js';

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

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
	| ReadyMessage
	| LoadCommitsMessage
	| LoadCommitDetailsMessage
	| OpenDiffMessage;

export interface CommitsMessage {
	type: 'commits';
	repoName: string | null;
	commits: Commit[];
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
