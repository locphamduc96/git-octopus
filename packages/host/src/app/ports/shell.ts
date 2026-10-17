import type {
	FileIconTheme,
	HostCapabilities,
	HostNoticeReplyMessage,
	HostProgressCancelMessage,
	HostToWebview,
	WebviewToHost,
} from '@git-octopus/shared';
import type { UserPrompt } from './userPrompt.js';

/**
 * Ports: what the host's services need from the shell they run in — VS Code for the extension,
 * Electron for the desktop app. Everything here is about the world around the repository; git
 * itself goes through `GitExecutor`, and questions to the user through `UserPrompt`.
 */

/** A notice the user can read and, with action labels, answer. Resolves to the action chosen. */
export interface Notifier {
	info(message: string, ...listActions: string[]): PromiseLike<string | undefined>;
	warn(message: string, ...listActions: string[]): PromiseLike<string | undefined>;
	error(message: string, ...listActions: string[]): PromiseLike<string | undefined>;
}

/** What a task running under a progress indicator can do with it. */
export interface ProgressHandle {
	/** A line under the title, replacing the previous one. */
	report(message: string): void;
	/** True once the user cancelled; only a cancellable run can be cancelled. */
	readonly cancelled: boolean;
	onCancel(listener: () => void): void;
}

export interface ProgressRunner {
	run<T>(
		title: string,
		task: (progress: ProgressHandle) => Promise<T>,
		options?: { cancellable?: boolean }
	): Promise<T>;
}

export interface Clipboard {
	writeText(text: string): PromiseLike<void>;
}

/** Hands things to the world outside the view. */
export interface Opener {
	openExternal(url: string): PromiseLike<unknown>;
	/** The folder in a window of its own — a worktree. */
	openFolderWindow(folder: string): PromiseLike<unknown>;
	openTerminal(cwd: string): void;
	/** A conflicted file, in whatever resolves conflicts here. Reports its own failure. */
	openMergeEditor(absolutePath: string): PromiseLike<void>;
	/** Read-only Markdown beside the graph — an AI explanation. */
	showMarkdown(content: string): PromiseLike<void>;
}

/** A file and its diff in the shell's editor, where there is one. */
export interface EditorDiff {
	openDiff(hash: string, filePath: string, cwd: string, oldPath?: string): Promise<void>;
	openCompareDiff(
		fromHash: string,
		toHash: string,
		filePath: string,
		cwd: string,
		oldPath?: string
	): Promise<void>;
	openWorkingDiff(filePath: string, cwd: string): Promise<void>;
	openFile(filePath: string, cwd: string, hash?: string): Promise<void>;
}

/** The user's settings, named under `gitOctopus.` — `identities`, `aiCommit.language`. */
export interface Settings {
	get<T>(key: string, fallback: T): T;
	update(key: string, value: unknown): PromiseLike<void>;
}

/** Stored state. VS Code's `Memento` has this shape, so its stores are handed over as they are. */
export interface KeyValueStore {
	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface Log {
	line(text: string): void;
}

/**
 * One view the controller drives: a webview in VS Code, a window in the desktop app. Compared by
 * identity — the controller keys its per-view state on the object itself.
 */
export interface ViewChannel {
	postMessage(message: HostToWebview): unknown;
	onDidReceiveMessage(listener: (message: WebviewToHost) => unknown): unknown;
}

/** What every service is handed. */
export interface HostShell {
	notify: Notifier;
	progress: ProgressRunner;
	clipboard: Clipboard;
	open: Opener;
	settings: Settings;
	log: Log;
}

/** The controller's shell: the services' ports, plus the views and what they look like. */
export interface ControllerShell extends HostShell {
	globalState: KeyValueStore;
	/** State that belongs to this workspace or window: the active repository, the filters. */
	workspaceState: KeyValueStore;
	editorDiff: EditorDiff;
	/** Questions asked when no view is there to ask them in. */
	fallbackPrompt: UserPrompt;
	/** Folders to look for repositories in. */
	listRoots(): string[];
	colorThemeKind(): 'light' | 'dark';
	/** Columns one tab spans in the editor — the diff panel draws code with the same width. */
	editorTabSize(): number;
	/** Ready a view before it is driven: its content, and what it may load. */
	prepareView(view: ViewChannel): Promise<void>;
	/** File icons as this view can load them; null when there is no icon theme. */
	fileIconsFor(view: ViewChannel): FileIconTheme | null;
	/** Read the icon theme again — the user switched it — and let the views load the new one. */
	reloadIconTheme(listViews: ViewChannel[]): Promise<void>;
	/** Bring the graph forward. */
	focusGraph(): PromiseLike<unknown>;
	/** Tell the shell whether a graph has keyboard focus — what its shortcuts are scoped to. */
	setGraphFocused(focused: boolean): void;
	/** Sent to each view once it listens; a shell that leaves it out gets the view's defaults. */
	capabilities?: HostCapabilities;
	/**
	 * A view answering a notice or cancelling a task that the shell showed inside it — for a shell
	 * with no notifications of its own, which shows them in the view.
	 */
	receiveViewReply?(message: HostNoticeReplyMessage | HostProgressCancelMessage): void;
}
