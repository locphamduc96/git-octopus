/**
 * Host ↔ webview message protocol.
 * Phase 1: load the commit graph. Grows with each phase of Feature 002.
 */
import type { Commit } from '../model/index.js';

export interface ReadyMessage {
	type: 'ready';
}

export interface LoadCommitsMessage {
	type: 'loadCommits';
	limit: number;
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHost = ReadyMessage | LoadCommitsMessage;

export interface CommitsMessage {
	type: 'commits';
	repoName: string | null;
	commits: Commit[];
}

export interface ErrorMessage {
	type: 'error';
	message: string;
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview = CommitsMessage | ErrorMessage;
