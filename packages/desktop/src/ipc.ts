/**
 * What the main process and a window's host process say to each other. The view's own traffic does
 * not pass through here: the renderer and the host talk over a MessagePort of their own.
 */
export type ThemeKind = 'light' | 'dark';

/** Main → host. */
export type MainToHost =
	| {
			kind: 'init';
			/** The folder this window shows: a repository, or a folder holding some. */
			folder: string;
			/** Where settings, state and the agent's workdir live — the app's userData folder. */
			dataDir: string;
			logDir: string;
			theme: ThemeKind;
			focused: boolean;
	  }
	/** A renderer is listening; its end of the channel comes with this message. */
	| { kind: 'view' }
	| { kind: 'theme'; theme: ThemeKind }
	| { kind: 'focus'; focused: boolean }
	| { kind: 'visible'; visible: boolean }
	| { kind: 'rpcResult'; id: number; ok: boolean; value?: unknown; error?: string };

/** What the host asks of main — the things only the main process can do. */
export interface MainRpc {
	writeClipboard(text: string): void;
	openExternal(url: string): void;
	/** Open a folder in a window of its own (a worktree). */
	openFolderWindow(folder: string): void;
	focusWindow(): void;
}

/** Host → main. */
export type HostToMain =
	| {
			kind: 'rpc';
			id: number;
			method: keyof MainRpc;
			args: unknown[];
	  }
	/** What the window's title and the Dock show. */
	| { kind: 'status'; repoName: string | null; branch: string | null; changeCount: number };

/** Height of the tab strip across the top of the window; each tab's view sits below it. */
export const TAB_STRIP_H = 38;

/** One tab in the strip: a folder, and what its view last reported. */
export interface TabInfo {
	id: number;
	/** The repository's name, or the folder's when it holds several. */
	title: string;
	branch: string | null;
	changeCount: number;
	folder: string;
}

/** Main → tab strip: everything it draws. */
export interface TabsState {
	listTabs: TabInfo[];
	activeId: number | null;
	theme: ThemeKind;
}

/** Tab strip → main: what its preload exposes as `gitOctopusTabs`. */
export interface TabsApi {
	onState(listener: (state: TabsState) => void): void;
	select(id: number): void;
	close(id: number): void;
	/** Ask for a folder and open it in a new tab. */
	add(): void;
	move(id: number, toIndex: number): void;
}
