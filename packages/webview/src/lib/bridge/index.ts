import type { HostToWebview, WebviewToHost } from '@git-octopus/shared';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState<T>(): T | undefined;
	setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function postToHost(message: WebviewToHost): void {
	vscode.postMessage(message);
}

/** Subscribe to typed messages coming from the extension host. Returns an unsubscribe fn. */
export function onHostMessage(handler: (message: HostToWebview) => void): () => void {
	const listener = (event: MessageEvent<HostToWebview>): void => handler(event.data);
	window.addEventListener('message', listener);
	return () => window.removeEventListener('message', listener);
}

/**
 * Bumped when defaults change in a way that should reach users who already have state stored;
 * a mismatch makes the app fall back to the current defaults instead of the saved preferences.
 */
export const STATE_VERSION = 3;

/** View preferences that survive the webview being hidden or reloaded. */
export interface PersistedState {
	version: number;
	columns: { author: boolean; commit: boolean; date: boolean };
	widths: { ref: number; author: number; commit: number; date: number };
	panelRatio: number;
	showRemoteBranches: boolean;
	settings: {
		commitLimit: number;
		dateFormat: 'dateTime' | 'dateOnly' | 'iso' | 'relative';
		graphStyle: 'rounded' | 'angular';
		fetchAvatars: boolean;
	};
}

export function readState(): Partial<PersistedState> {
	return vscode.getState<Partial<PersistedState>>() ?? {};
}

export function writeState(state: PersistedState): void {
	vscode.setState(state);
}
