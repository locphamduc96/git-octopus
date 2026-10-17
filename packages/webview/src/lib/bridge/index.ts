import type { HiddenRefs } from '@git-octopus/shared';
import type { HostToWebview, WebviewToHost } from '@git-octopus/shared';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState<T>(): T | undefined;
	setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * What the desktop app's preload hands the page: the same three calls, with every value crossing as
 * JSON text — the context bridge structured-clones what it is given, and `$state` proxies cannot be.
 */
interface DesktopHost {
	post(json: string): void;
	getState(): string | null;
	setState(json: string): void;
}

/** VS Code's API inside VS Code; the desktop app's preload, shaped the same, everywhere else. */
function connect(): VsCodeApi {
	if (typeof acquireVsCodeApi === 'function') return acquireVsCodeApi();
	const host = (globalThis as { gitOctopusHost?: DesktopHost }).gitOctopusHost;
	if (!host) throw new Error('Git Octopus: no host to talk to.');
	return {
		postMessage: (message) => host.post(JSON.stringify(message)),
		getState: <T>() => {
			const json = host.getState();
			return json === null ? undefined : (JSON.parse(json) as T);
		},
		setState: (state) => host.setState(JSON.stringify(state)),
	};
}

const vscode = connect();

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
	/** The AI commit plan being edited, so a destroyed webview hands it back — see `stores/aiCommit`. */
	aiCommit?: PersistedAiCommit;
	/** Repository path → the branch pinned to the graph's left edge there. */
	mapPinned?: Record<string, string>;
	/** Repository path → the refs hidden from the graph there. */
	mapHidden?: Record<string, HiddenRefs>;
}

export interface PersistedAiCommit {
	repoPath: string;
	/** The host generation the plan came from; null when it outlived the host (window reload). */
	generationId: number | null;
	/** An `EditablePlan`; typed loosely because storage outlives any one version's shape. */
	plan: unknown;
	mode: 'single' | 'split';
}

export function readState(): Partial<PersistedState> {
	return vscode.getState<Partial<PersistedState>>() ?? {};
}

export function writeState(state: PersistedState): void {
	vscode.setState(state);
}

/**
 * Merge a patch over what is stored. Every writer must come through here (or send the whole
 * object): a plain `setState` from one domain would silently drop the others' keys.
 */
export function updateState(patch: Partial<PersistedState>): void {
	const stored = readState();
	const base = stored.version === STATE_VERSION ? stored : {};
	vscode.setState({ ...base, ...patch, version: STATE_VERSION });
}
