import type { HostToWebview, WebviewToHost } from '@git-octopus/shared';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState<T>(): T | undefined;
	setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/**
 * Send a typed message to the extension host.
 *
 * Always a plain copy. `postMessage` structured-clones its argument, and a structured clone of a
 * Proxy throws — which is what any piece of `$state` is. Passing reactive state straight in makes
 * the message vanish *and* takes down whatever was running: an effect that dies mid-flush can stop
 * the rest of the component from ever starting. One copy here is cheaper than remembering it at
 * every call site.
 */
export function postToHost(message: WebviewToHost): void {
	vscode.postMessage(JSON.parse(JSON.stringify(message)) as WebviewToHost);
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

/**
 * What survives the webview being hidden or reloaded, and belongs to *this window*: sizes chosen
 * against this monitor and this repository's ref names.
 *
 * Nothing else. Every preference lives in the host's global state and arrives as a `viewSettings`
 * message — one place, one answer. Earlier versions also kept a copy of the settings here; those
 * keys are no longer read, and the first write drops them.
 */
export interface PersistedState {
	version: number;
	widths: { ref: number; author: number; commit: number; date: number };
	panelRatio: number;
}

export function readState(): Partial<PersistedState> {
	return vscode.getState<Partial<PersistedState>>() ?? {};
}

export function writeState(state: PersistedState): void {
	vscode.setState(state);
}
