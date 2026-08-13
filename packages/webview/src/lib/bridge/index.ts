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

/** View preferences that survive the webview being hidden or reloaded. */
export interface PersistedState {
	columns: { author: boolean; commit: boolean; date: boolean };
	panelRatio: number;
	showRemoteBranches: boolean;
	settings: {
		commitLimit: number;
		dateFormat: 'dateTime' | 'dateOnly' | 'iso' | 'relative';
		graphStyle: 'rounded' | 'angular';
	};
}

export function readState(): Partial<PersistedState> {
	return vscode.getState<Partial<PersistedState>>() ?? {};
}

export function writeState(state: PersistedState): void {
	vscode.setState(state);
}
