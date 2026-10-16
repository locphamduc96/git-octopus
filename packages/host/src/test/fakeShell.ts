import type { ControllerShell, EditorDiff, HostShell, KeyValueStore } from '../app/ports/shell.js';
import type { UserPrompt } from '../app/ports/userPrompt.js';

/**
 * The shell, for tests: nothing is shown or opened, everything is recorded. A service under test
 * is handed `testShell`; a controller, `controllerShell()`.
 */
export interface ShellRecord {
	listInfo: string[];
	/** Warnings kept apart from information messages: a guard that stops an action warns. */
	listWarnings: string[];
	listErrors: string[];
	listClipboard: string[];
	/** URLs handed to the browser. */
	listOpened: string[];
	/** Folders opened in a window of their own — worktrees. */
	listFolderWindows: string[];
	/** Working directories a terminal was opened in. */
	listTerminals: string[];
	/** Absolute paths handed to the merge editor. */
	listMergeEditor: string[];
	/** Markdown shown beside the graph. */
	listDocuments: { language: string; content: string }[];
	/** Titles of the tasks run under a progress indicator. */
	listProgress: string[];
	listLog: string[];
	/** How many times the graph was brought forward. */
	focusCount: number;
	/** Every keyboard-focus state the shell was told, in order. */
	listGraphFocused: boolean[];
}

export const recorded: ShellRecord = {
	listInfo: [],
	listWarnings: [],
	listErrors: [],
	listClipboard: [],
	listOpened: [],
	listFolderWindows: [],
	listTerminals: [],
	listMergeEditor: [],
	listDocuments: [],
	listProgress: [],
	listLog: [],
	focusCount: 0,
	listGraphFocused: [],
};

/** Settings keyed `gitOctopus.<key>` — the name a user sees in settings.json. Seeded by a test. */
export const mapConfig = new Map<string, unknown>();

export function resetRecorded(): void {
	for (const value of Object.values(recorded)) {
		if (Array.isArray(value)) value.length = 0;
	}
	recorded.focusCount = 0;
	mapConfig.clear();
}

const notice =
	(list: string[]) =>
	(message: string): Promise<undefined> => {
		list.push(message);
		return Promise.resolve(undefined);
	};

export const testShell: HostShell = {
	notify: {
		info: notice(recorded.listInfo),
		warn: notice(recorded.listWarnings),
		error: notice(recorded.listErrors),
	},
	progress: {
		/** Runs the task straight away: the indicator itself is the shell's, not ours to test. */
		run: (title, task) => {
			recorded.listProgress.push(title);
			return task({ report: () => undefined, cancelled: false, onCancel: () => undefined });
		},
	},
	clipboard: {
		writeText: (text) => {
			recorded.listClipboard.push(text);
			return Promise.resolve();
		},
	},
	open: {
		openExternal: (url) => {
			recorded.listOpened.push(url);
			return Promise.resolve(true);
		},
		openFolderWindow: (folder) => {
			recorded.listFolderWindows.push(folder);
			return Promise.resolve();
		},
		openTerminal: (cwd) => void recorded.listTerminals.push(cwd),
		openMergeEditor: (absolutePath) => {
			recorded.listMergeEditor.push(absolutePath);
			return Promise.resolve();
		},
		showMarkdown: (content) => {
			recorded.listDocuments.push({ language: 'markdown', content });
			return Promise.resolve();
		},
	},
	settings: {
		get: <T>(key: string, fallback: T): T =>
			mapConfig.has(`gitOctopus.${key}`) ? (mapConfig.get(`gitOctopus.${key}`) as T) : fallback,
		update: (key, value) => {
			mapConfig.set(`gitOctopus.${key}`, value);
			return Promise.resolve();
		},
	},
	log: { line: (text) => void recorded.listLog.push(text) },
};

export interface FakeMemento extends KeyValueStore {
	/** What the controller has written, for a test to read back. */
	readonly mapStored: Map<string, unknown>;
}

export function memento(mapInitial: Record<string, unknown> = {}): FakeMemento {
	const mapStored = new Map<string, unknown>(Object.entries(mapInitial));
	return {
		mapStored,
		get: ((key: string, fallback?: unknown) =>
			mapStored.has(key) ? mapStored.get(key) : fallback) as FakeMemento['get'],
		update: (key: string, value: unknown) => {
			mapStored.set(key, value);
			return Promise.resolve();
		},
	};
}

export const IDLE_DIFF: EditorDiff = {
	openDiff: () => Promise.resolve(),
	openCompareDiff: () => Promise.resolve(),
	openWorkingDiff: () => Promise.resolve(),
	openFile: () => Promise.resolve(),
};

/** With no view to ask in, every question goes unanswered. */
export const DISMISSING_PROMPT: UserPrompt = {
	confirm: () => Promise.resolve(false),
	pickOptions: () => Promise.resolve(undefined),
	inputText: () => Promise.resolve(undefined),
};

export function controllerShell(over: Partial<ControllerShell> = {}): ControllerShell {
	return {
		...testShell,
		globalState: memento(),
		workspaceState: memento(),
		editorDiff: IDLE_DIFF,
		fallbackPrompt: DISMISSING_PROMPT,
		listRoots: () => [],
		colorThemeKind: () => 'dark',
		prepareView: () => Promise.resolve(),
		fileIconsFor: () => null,
		reloadIconTheme: () => Promise.resolve(),
		focusGraph: () => {
			recorded.focusCount += 1;
			return Promise.resolve();
		},
		setGraphFocused: (focused) => void recorded.listGraphFocused.push(focused),
		...over,
	};
}
