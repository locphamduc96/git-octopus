import * as path from 'node:path';

/**
 * Enough of the `vscode` module to load an adapter under test.
 *
 * The adapters are where VS Code UI lives, so they cannot be imported at all without this — and
 * the decisions worth testing (which git commands an action runs, when it refuses, whether a
 * prompt goes away) sit in those same files. Nothing here performs anything: calls are recorded,
 * and the pickers stay open until a test answers them or their token is cancelled.
 */
export interface OpenPrompt {
	kind: 'quickPick' | 'inputBox';
	title: string | undefined;
	/** Resolve as if the user had answered; undefined stands for dismissal. */
	answer: (value: unknown) => void;
	/** True once the token cancelled it — what "the prompt left the screen" looks like here. */
	cancelled: boolean;
	settled: boolean;
}

export interface StubCommand {
	command: string;
	listArgs: unknown[];
}

export interface StubTerminal {
	name: string | undefined;
	cwd: string | undefined;
	/** True once `.show()` was called — an adapter that creates a terminal must also reveal it. */
	shown: boolean;
}

export interface StubRecord {
	listInfo: string[];
	/** Warnings kept apart from information messages: a guard that stops an action warns. */
	listWarnings: string[];
	listErrors: string[];
	listClipboard: string[];
	listOpened: string[];
	/** Every picker shown, in order, whether or not it has been answered. */
	listPrompts: OpenPrompt[];
	listCommands: StubCommand[];
	listTerminals: StubTerminal[];
	/** Lines written to any output channel — the trace an adapter leaves behind. */
	listLog: string[];
	/** Editor tabs created through `window.createWebviewPanel`, in order. */
	listPanels: StubWebviewPanel[];
	/** Untitled documents opened through `workspace.openTextDocument`, in order. */
	listDocuments: { language?: string; content?: string }[];
}

export interface StubWebviewPanel {
	viewType: string;
	title: string;
	webview: { id: string };
	iconPath: unknown;
	visible: boolean;
	disposed: boolean;
	/** How many times the tab was brought forward after it was created. */
	revealCount: number;
	reveal(): void;
	dispose(): void;
	onDidDispose(listener: () => void): { dispose(): void };
	onDidChangeViewState(listener: () => void): { dispose(): void };
	/** Stands in for the user switching to another tab and back. */
	setVisible(visible: boolean): void;
}

/** A tab as `createWebviewPanel` makes it, or as VS Code hands one back to a serializer. */
export function makeWebviewPanel(viewType: string, title: string): StubWebviewPanel {
	const listDisposeListeners: (() => void)[] = [];
	const listStateListeners: (() => void)[] = [];
	const panel: StubWebviewPanel = {
		viewType,
		title,
		webview: { id: `${viewType}#${Math.random()}` },
		iconPath: undefined,
		visible: true,
		disposed: false,
		revealCount: 0,
		reveal: () => void (panel.revealCount += 1),
		dispose: () => {
			if (panel.disposed) return;
			panel.disposed = true;
			for (const listener of listDisposeListeners) listener();
		},
		onDidDispose: (listener) => {
			listDisposeListeners.push(listener);
			return { dispose: () => undefined };
		},
		onDidChangeViewState: (listener) => {
			listStateListeners.push(listener);
			return { dispose: () => undefined };
		},
		setVisible: (visible) => {
			panel.visible = visible;
			for (const listener of listStateListeners) listener();
		},
	};
	return panel;
}

export const recorded: StubRecord = {
	listInfo: [],
	listWarnings: [],
	listErrors: [],
	listClipboard: [],
	listOpened: [],
	listPrompts: [],
	listCommands: [],
	listTerminals: [],
	listLog: [],
	listPanels: [],
	listDocuments: [],
};

/** VS Code's own numbering for the two symbolic columns. */
export const ViewColumn = {
	Active: -1,
	Beside: -2,
};

/** Settings, keyed `<section>.<key>`. Seeded by a test, written by `getConfiguration().update`. */
export const mapConfig = new Map<string, unknown>();

/** VS Code's own numbering, so a target comparison means what it means in the editor. */
export const ConfigurationTarget = {
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3,
};

/** Which scope each setting was written to — an identity saved per-workspace would be a bug. */
export const mapConfigTarget = new Map<string, number | undefined>();

/** What `workspace.fs.readFile` serves, keyed by `fsPath`. Anything else rejects. */
export const mapFiles = new Map<string, string>();

/** VS Code's own numbering, so a `ColorThemeKind` comparison means what it means in the editor. */
export const ColorThemeKind = {
	Light: 1,
	Dark: 2,
	HighContrast: 3,
	HighContrastLight: 4,
};

export function resetRecorded(): void {
	recorded.listInfo.length = 0;
	recorded.listWarnings.length = 0;
	recorded.listErrors.length = 0;
	recorded.listClipboard.length = 0;
	recorded.listOpened.length = 0;
	recorded.listPrompts.length = 0;
	recorded.listCommands.length = 0;
	recorded.listTerminals.length = 0;
	recorded.listLog.length = 0;
	recorded.listPanels.length = 0;
	recorded.listDocuments.length = 0;
	mapConfig.clear();
	mapConfigTarget.clear();
	mapFiles.clear();
	listWatchers.length = 0;
	listWindowStateListeners.length = 0;
	// Module state a previous test seeded; left standing it silently configures the next one.
	workspace.workspaceFolders = [];
	extensions.all = [];
	window.activeColorTheme = { kind: ColorThemeKind.Dark };
}

/** Prompts still on screen — none should survive their git process. */
export function openPrompts(): OpenPrompt[] {
	return recorded.listPrompts.filter((prompt) => !prompt.settled);
}

interface StubToken {
	isCancellationRequested: boolean;
	onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

/** A picker that resolves when answered, or when its token is cancelled. */
function showPrompt(
	kind: OpenPrompt['kind'],
	title: string | undefined,
	token?: StubToken
): Promise<unknown> {
	return new Promise((resolve) => {
		const prompt: OpenPrompt = {
			kind,
			title,
			cancelled: false,
			settled: false,
			answer: (value) => {
				if (prompt.settled) return;
				prompt.settled = true;
				resolve(value);
			},
		};
		recorded.listPrompts.push(prompt);
		if (token) {
			if (token.isCancellationRequested) {
				prompt.cancelled = true;
				prompt.answer(undefined);
				return;
			}
			token.onCancellationRequested(() => {
				prompt.cancelled = true;
				prompt.answer(undefined);
			});
		}
	});
}

/** Window-focus listeners; `fireWindowState` in a test stands in for the user coming back. */
const listWindowStateListeners: ((state: { focused: boolean }) => void)[] = [];

export function fireWindowState(focused: boolean): void {
	for (const listener of listWindowStateListeners) listener({ focused });
}

export const ProgressLocation = {
	SourceControl: 1,
	Window: 10,
	Notification: 15,
} as const;

export const window = {
	/** Runs the task straight away: the progress UI itself is VS Code's, not ours to test. */
	withProgress: <T>(
		_options: unknown,
		task: (
			progress: { report: (value: unknown) => void },
			token: {
				isCancellationRequested: boolean;
				onCancellationRequested: () => { dispose(): void };
			}
		) => Promise<T>
	): Promise<T> =>
		task(
			{ report: () => undefined },
			{
				isCancellationRequested: false,
				onCancellationRequested: () => ({ dispose: () => undefined }),
			}
		),
	showTextDocument: (): Promise<undefined> => Promise.resolve(undefined),
	onDidChangeWindowState: (listener: (state: { focused: boolean }) => void) => {
		listWindowStateListeners.push(listener);
		return {
			dispose: (): void => {
				const at = listWindowStateListeners.indexOf(listener);
				if (at !== -1) listWindowStateListeners.splice(at, 1);
			},
		};
	},
	showInformationMessage: (message: string): Promise<undefined> => {
		recorded.listInfo.push(message);
		return Promise.resolve(undefined);
	},
	showErrorMessage: (message: string): Promise<undefined> => {
		recorded.listErrors.push(message);
		return Promise.resolve(undefined);
	},
	showWarningMessage: (message: string): Promise<undefined> => {
		recorded.listWarnings.push(message);
		return Promise.resolve(undefined);
	},
	showQuickPick: (
		_items: unknown,
		options?: { title?: string },
		token?: StubToken
	): Promise<unknown> => showPrompt('quickPick', options?.title, token),
	showInputBox: (options?: { title?: string }, token?: StubToken): Promise<unknown> =>
		showPrompt('inputBox', options?.title, token),
	// Several adapters open a channel at module scope, so importing them at all needs this.
	createOutputChannel: (name: string) => ({
		name,
		append: (text: string): void => void recorded.listLog.push(text),
		appendLine: (line: string): void => void recorded.listLog.push(line),
		clear: (): void => void (recorded.listLog.length = 0),
		show: (): void => undefined,
		hide: (): void => undefined,
		dispose: (): void => undefined,
	}),
	activeColorTheme: { kind: ColorThemeKind.Dark },
	createWebviewPanel: (viewType: string, title: string): StubWebviewPanel => {
		const panel = makeWebviewPanel(viewType, title);
		recorded.listPanels.push(panel);
		return panel;
	},
	createTerminal: (options?: { name?: string; cwd?: string }) => {
		const entry: StubTerminal = { name: options?.name, cwd: options?.cwd, shown: false };
		recorded.listTerminals.push(entry);
		return {
			show: (): void => void (entry.shown = true),
			sendText: (): void => undefined,
			dispose: (): void => undefined,
		};
	},
};

export const env = {
	clipboard: {
		writeText: (text: string): Promise<void> => {
			recorded.listClipboard.push(text);
			return Promise.resolve();
		},
	},
	openExternal: (uri: { toString: () => string }): Promise<boolean> => {
		recorded.listOpened.push(uri.toString());
		return Promise.resolve(true);
	},
};

/** Enough of a `vscode.Uri` to be joined, handed to a webview and printed into HTML. */
export interface StubUri {
	scheme: string;
	path: string;
	fsPath: string;
	toString: () => string;
}

function fileUri(fsPath: string): StubUri {
	return { scheme: 'file', path: fsPath, fsPath, toString: () => `file://${fsPath}` };
}

export const Uri = {
	parse: (value: string): { toString: () => string } => ({ toString: () => value }),
	file: (fsPath: string): StubUri => fileUri(fsPath),
	// `path.join` and not a plain concat: callers walk upwards with `joinPath(file, '..')`.
	joinPath: (base: StubUri, ...listSegments: string[]): StubUri =>
		fileUri(path.join(base.fsPath, ...listSegments)),
};

export interface StubWorkspaceFolder {
	uri: StubUri;
	name: string;
	index: number;
}

/** A `RelativePattern`, recording only what the watcher was rooted at and what it matches. */
export class RelativePattern {
	public readonly baseUri: StubUri;

	public constructor(
		base: StubUri,
		public readonly pattern: string
	) {
		this.baseUri = base;
	}

	public get base(): string {
		return this.baseUri.fsPath;
	}
}

/** A file-system watcher whose listeners a test can fire by hand. */
export interface StubWatcher {
	pattern: RelativePattern;
	disposed: boolean;
	fire(kind: 'change' | 'create' | 'delete', fsPath: string): void;
	onDidChange(listener: (uri: StubUri) => void): { dispose(): void };
	onDidCreate(listener: (uri: StubUri) => void): { dispose(): void };
	onDidDelete(listener: (uri: StubUri) => void): { dispose(): void };
	dispose(): void;
}

/** Every watcher created since the last reset, in creation order. */
export const listWatchers: StubWatcher[] = [];

function makeWatcher(pattern: RelativePattern): StubWatcher {
	const mapListeners: Record<string, ((uri: StubUri) => void)[]> = {
		change: [],
		create: [],
		delete: [],
	};
	const on = (kind: string) => (listener: (uri: StubUri) => void) => {
		mapListeners[kind].push(listener);
		return {
			dispose: (): void => {
				const at = mapListeners[kind].indexOf(listener);
				if (at !== -1) mapListeners[kind].splice(at, 1);
			},
		};
	};
	return {
		pattern,
		disposed: false,
		fire(kind, fsPath): void {
			for (const listener of mapListeners[kind]) listener(fileUri(fsPath));
		},
		onDidChange: on('change'),
		onDidCreate: on('create'),
		onDidDelete: on('delete'),
		dispose(): void {
			this.disposed = true;
		},
	};
}

export const workspace = {
	/** Empty by default — a repository scan only finds what a test puts here. */
	workspaceFolders: [] as StubWorkspaceFolder[],
	getConfiguration: (section: string) => ({
		get: (key: string, fallback?: unknown): unknown => {
			const value = mapConfig.get(`${section}.${key}`);
			return value === undefined ? fallback : value;
		},
		update: (key: string, value: unknown, target?: number): Promise<void> => {
			mapConfig.set(`${section}.${key}`, value);
			mapConfigTarget.set(`${section}.${key}`, target);
			return Promise.resolve();
		},
		has: (key: string): boolean => mapConfig.has(`${section}.${key}`),
	}),
	openTextDocument: (options: { language?: string; content?: string }) => {
		recorded.listDocuments.push(options);
		return Promise.resolve({ ...options });
	},
	createFileSystemWatcher: (pattern: RelativePattern): StubWatcher => {
		const watcher = makeWatcher(pattern);
		listWatchers.push(watcher);
		return watcher;
	},
	fs: {
		readFile: (uri: StubUri): Promise<Uint8Array> => {
			const content = mapFiles.get(uri.fsPath);
			return content === undefined
				? Promise.reject(new Error(`ENOENT: no stub file at ${uri.fsPath}`))
				: Promise.resolve(new TextEncoder().encode(content));
		},
	},
};

export const commands = {
	executeCommand: (command: string, ...listArgs: unknown[]): Promise<undefined> => {
		recorded.listCommands.push({ command, listArgs });
		return Promise.resolve(undefined);
	},
};

export interface StubExtension {
	id: string;
	extensionUri: StubUri;
	packageJSON: Record<string, unknown>;
}

/** Empty by default: nothing contributes an icon theme or a language unless a test says so. */
export const extensions = {
	all: [] as StubExtension[],
	/** Nothing is installed unless a test says so — notably not the built-in Git extension. */
	getExtension: (_id: string): undefined => undefined,
};

export class CancellationTokenSource {
	private readonly listListeners: (() => void)[] = [];
	public readonly token: StubToken = {
		isCancellationRequested: false,
		onCancellationRequested: (listener: () => void) => {
			this.listListeners.push(listener);
			return { dispose: () => undefined };
		},
	};

	public cancel(): void {
		if (this.token.isCancellationRequested) return;
		this.token.isCancellationRequested = true;
		for (const listener of this.listListeners) listener();
	}

	public dispose(): void {
		this.listListeners.length = 0;
	}
}
