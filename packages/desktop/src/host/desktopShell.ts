import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type {
	HostNoticeReplyMessage,
	HostProgressCancelMessage,
	HostToWebview,
} from '@git-octopus/shared';
import type {
	ControllerShell,
	ProgressHandle,
	ViewChannel,
} from '@git-octopus/host/app/ports/shell';
import type { UserPrompt } from '@git-octopus/host/app/ports/userPrompt';
import type { MainRpc, ThemeKind } from '../ipc.js';
import { JsonStore, scoped } from './jsonStore.js';

/** With no view to ask in, every question goes unanswered — a desktop window always has one. */
const DISMISSING_PROMPT: UserPrompt = {
	confirm: () => Promise.resolve(false),
	pickOptions: () => Promise.resolve(undefined),
	inputText: () => Promise.resolve(undefined),
};

export interface DesktopShellOptions {
	folder: string;
	dataDir: string;
	logDir: string;
	theme: ThemeKind;
	/** Ask the main process — the only one that may touch the clipboard, windows and browsers. */
	rpc: <K extends keyof MainRpc>(method: K, ...args: Parameters<MainRpc[K]>) => Promise<unknown>;
	/** The saved view settings, read per use so a changed choice applies at once. */
	readViewSettings?: () => { terminalApp?: string } | null;
	/** Runs `open` with these arguments; replaced in tests. */
	runOpen?: (listArgs: string[]) => Promise<void>;
}

/** What `open` is given to start each terminal at a directory. */
const mapTerminalArgs: Record<string, (cwd: string) => string[]> = {
	Terminal: (cwd) => ['-a', 'Terminal', cwd],
	iTerm: (cwd) => ['-a', 'iTerm', cwd],
	Ghostty: (cwd) => ['-na', 'Ghostty', '--args', `--working-directory=${cwd}`],
	Warp: (cwd) => [`warp://action/new_window?path=${encodeURIComponent(cwd)}`],
};

/** `open` hands a path or a URL to whatever macOS has registered for it. */
function macOpen(...listArgs: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('open', listArgs, (error) => (error ? reject(error) : resolve()));
	});
}

/**
 * The controller's shell in the desktop app: notices and progress drawn inside the window, stores
 * kept as JSON files, and whatever needs the main process asked of it over RPC.
 */
export class DesktopShell implements ControllerShell {
	public readonly capabilities = { desktop: true, editorDiff: false };
	public readonly settings: JsonStore;
	public readonly globalState: JsonStore;
	public readonly workspaceState;
	public readonly fallbackPrompt = DISMISSING_PROMPT;
	private readonly setViews = new Set<ViewChannel>();
	private theme: ThemeKind;
	private nextId = 1;
	private readonly mapNoticeAnswers = new Map<number, (action: string | undefined) => void>();
	private readonly mapTasks = new Map<number, { cancelled: boolean; listCancel: (() => void)[] }>();
	private readonly logFile: string;

	public constructor(private readonly options: DesktopShellOptions) {
		this.theme = options.theme;
		this.settings = new JsonStore(path.join(options.dataDir, 'settings.json'));
		this.globalState = new JsonStore(path.join(options.dataDir, 'state.json'));
		this.workspaceState = scoped(
			new JsonStore(path.join(options.dataDir, 'folders.json')),
			options.folder
		);
		mkdirSync(options.logDir, { recursive: true });
		this.logFile = path.join(options.logDir, 'host.log');
	}

	public setTheme(theme: ThemeKind): void {
		this.theme = theme;
	}

	private post(message: HostToWebview): void {
		for (const view of this.setViews) view.postMessage(message);
	}

	private notice(level: 'info' | 'warning' | 'error') {
		return (message: string, ...listActions: string[]): Promise<string | undefined> => {
			const id = this.nextId++;
			this.log.line(`[${level}] ${message}`);
			this.post({ type: 'hostNotice', id, level, message, listActions });
			// A notice that asks nothing has nothing to wait for.
			if (listActions.length === 0) return Promise.resolve(undefined);
			return new Promise((resolve) => this.mapNoticeAnswers.set(id, resolve));
		};
	}

	public readonly notify = {
		info: this.notice('info'),
		warn: this.notice('warning'),
		error: this.notice('error'),
	};

	public readonly progress = {
		run: async <T>(
			title: string,
			task: (progress: ProgressHandle) => Promise<T>,
			options?: { cancellable?: boolean }
		): Promise<T> => {
			const id = this.nextId++;
			const cancellable = options?.cancellable ?? false;
			const state = { cancelled: false, listCancel: [] as (() => void)[] };
			this.mapTasks.set(id, state);
			this.post({ type: 'hostProgress', id, title, cancellable, done: false });
			try {
				return await task({
					report: (message) =>
						this.post({ type: 'hostProgress', id, title, message, cancellable, done: false }),
					get cancelled() {
						return state.cancelled;
					},
					onCancel: (listener) => void state.listCancel.push(listener),
				});
			} finally {
				this.mapTasks.delete(id);
				this.post({ type: 'hostProgress', id, title, cancellable, done: true });
			}
		},
	};

	public receiveViewReply(message: HostNoticeReplyMessage | HostProgressCancelMessage): void {
		if (message.type === 'hostNoticeReply') {
			this.mapNoticeAnswers.get(message.id)?.(message.action);
			this.mapNoticeAnswers.delete(message.id);
			return;
		}
		const task = this.mapTasks.get(message.id);
		if (!task || task.cancelled) return;
		task.cancelled = true;
		for (const listener of task.listCancel) listener();
	}

	public readonly clipboard = {
		writeText: async (text: string): Promise<void> => {
			await this.options.rpc('writeClipboard', text);
		},
	};

	public readonly open = {
		openExternal: (url: string) => this.options.rpc('openExternal', url),
		openFolderWindow: (folder: string) => this.options.rpc('openFolderWindow', folder),
		openTerminal: (cwd: string): void => void this.launchTerminal(cwd),
		// Until an editor can be chosen (113d): the file as macOS would open it on a double-click.
		openMergeEditor: (absolutePath: string): Promise<void> =>
			macOpen(absolutePath).catch((error: unknown) => {
				void this.notify.error(`Git Octopus: could not open ${absolutePath} — ${String(error)}`);
			}),
		// Until the Markdown panel (113d): a file of its own, in the default Markdown app.
		showMarkdown: async (content: string): Promise<void> => {
			const dir = path.join(this.options.dataDir, 'explanations');
			mkdirSync(dir, { recursive: true });
			const file = path.join(dir, `explanation-${Date.now()}.md`);
			writeFileSync(file, content);
			await macOpen(file);
		},
	};

	private async launchTerminal(cwd: string): Promise<void> {
		const run = this.options.runOpen ?? ((listArgs: string[]) => macOpen(...listArgs));
		const chosen = this.options.readViewSettings?.()?.terminalApp;
		const app = chosen !== undefined && Object.hasOwn(mapTerminalArgs, chosen) ? chosen : 'Terminal';
		try {
			await run(mapTerminalArgs[app](cwd));
			return;
		} catch {
			if (app === 'Terminal') return;
		}
		void this.notify.warn(`Git Octopus: could not open ${app}, opened Terminal instead.`);
		await run(mapTerminalArgs.Terminal(cwd)).catch(() => undefined);
	}

	public readonly log = {
		line: (text: string): void => {
			try {
				appendFileSync(this.logFile, `${text}\n`);
			} catch {
				// A log that cannot be written must not take the host down with it.
			}
		},
	};

	public readonly editorDiff = {
		openDiff: () => Promise.resolve(),
		openCompareDiff: () => Promise.resolve(),
		openWorkingDiff: () => Promise.resolve(),
		openFile: async (filePath: string, cwd: string, hash?: string): Promise<void> => {
			if (!hash) {
				await macOpen(path.join(cwd, filePath));
				return;
			}
			// A file as a commit had it: read out of git into a scratch copy, opened read-only.
			const dir = path.join(this.options.dataDir, 'revisions', hash.slice(0, 12));
			const target = path.join(dir, filePath);
			mkdirSync(path.dirname(target), { recursive: true });
			await new Promise<void>((resolve, reject) => {
				const child = spawn('git', ['show', `${hash}:${filePath}`], { cwd });
				const listChunks: Buffer[] = [];
				child.stdout.on('data', (chunk: Buffer) => listChunks.push(chunk));
				child.on('error', reject);
				child.on('close', (code) => {
					if (code !== 0) return reject(new Error(`git show exited with ${code}`));
					writeFileSync(target, Buffer.concat(listChunks), { mode: 0o444 });
					resolve();
				});
			});
			await macOpen(target);
		},
	};

	public listRoots(): string[] {
		return [this.options.folder];
	}

	public colorThemeKind(): ThemeKind {
		return this.theme;
	}

	/** No editor to follow: four columns, what most editors default to. */
	public editorTabSize(): number {
		return 4;
	}

	public prepareView(view: ViewChannel): Promise<void> {
		this.setViews.add(view);
		return Promise.resolve();
	}

	public forgetView(view: ViewChannel): void {
		this.setViews.delete(view);
	}

	public fileIconsFor(): null {
		return null;
	}

	public reloadIconTheme(): Promise<void> {
		return Promise.resolve();
	}

	public focusGraph(): Promise<unknown> {
		return this.options.rpc('focusWindow');
	}

	public setGraphFocused(): void {
		// The window's own menu carries the graph's shortcuts; there is no context key to set.
	}
}
