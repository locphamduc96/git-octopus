import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type {
	DesktopViewMessage,
	HostNoticeReplyMessage,
	HostProgressCancelMessage,
	HostToWebview,
	ShowMarkdownMessage,
} from '@git-octopus/shared';
import { resolveGitProgram } from '@git-octopus/host/adapters/process/gitProgram';
import {
	readHostViewSettings,
	type HostViewSettings,
} from '@git-octopus/host/adapters/services/CommitActionService';
import type {
	ControllerShell,
	ProgressHandle,
	ViewChannel,
} from '@git-octopus/host/app/ports/shell';
import type { UserPrompt } from '@git-octopus/host/app/ports/userPrompt';
import type { MainRpc, ThemeKind } from '../ipc.js';
import { VIEW_SETTINGS_KEY } from '../themeSource.js';
import {
	ExternalEditor,
	parseExternalEditorSetting,
	type ExternalEditorSetting,
} from './externalEditor.js';
import { JsonStore, scoped } from './jsonStore.js';
import { ViewCredentialPrompt } from './viewCredentialPrompt.js';

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
	readViewSettings?: () => HostViewSettings | null;
	/** The view settings were just saved by this window. */
	onViewSettingsSaved?: (settings: HostViewSettings | null) => void;
	/** Runs `open` with these arguments; replaced in tests. */
	runOpen?: (listArgs: string[]) => Promise<void>;
	/** Opens files in the editor the user chose; replaced in tests. */
	externalEditor?: ExternalEditor;
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
 * The editor the settings name: a command typed by the user, one of the known editors, or whichever
 * is installed. An empty command or an unknown value means the latter.
 */
export function externalEditorFromSettings(
	settings: HostViewSettings | null
): ExternalEditorSetting {
	if (settings?.externalEditor === 'custom') {
		return parseExternalEditorSetting({ command: settings.externalEditorCommand });
	}
	return parseExternalEditorSetting(settings?.externalEditor);
}

/** A panel title for Markdown that starts with a heading, else a plain one. */
export function markdownTitle(content: string): string {
	const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(content);
	return heading ? heading[1].trim() : 'Explanation';
}

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
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
	/** Where git's questions for a password or a host key are put to the user. */
	public readonly credentialPrompt: ViewCredentialPrompt;
	private readonly setViews = new Set<ViewChannel>();
	private theme: ThemeKind;
	private nextId = 1;
	private readonly mapNoticeAnswers = new Map<number, (action: string | undefined) => void>();
	private readonly mapTasks = new Map<number, { cancelled: boolean; listCancel: (() => void)[] }>();
	private readonly logFile: string;
	private readonly editor: ExternalEditor;
	/** Markdown shown while no view was there to take it. */
	private listUnshownMarkdown: ShowMarkdownMessage[] = [];

	public constructor(private readonly options: DesktopShellOptions) {
		this.theme = options.theme;
		this.editor = options.externalEditor ?? new ExternalEditor();
		this.credentialPrompt = new ViewCredentialPrompt((message) => this.post(message));
		this.settings = new JsonStore(path.join(options.dataDir, 'settings.json'));
		this.globalState = new JsonStore(path.join(options.dataDir, 'state.json'), (key, value) => {
			if (key === VIEW_SETTINGS_KEY) options.onViewSettingsSaved?.(readHostViewSettings(value));
		});
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

	/** What the view says to the window rather than to the repository; the controller never sees it. */
	public receiveDesktopMessage(message: DesktopViewMessage): void {
		switch (message.type) {
			case 'credentialReply':
				this.credentialPrompt.receiveReply(message);
				return;
			case 'openLink':
				if (isHttps(message.url)) void this.open.openExternal(message.url);
				return;
			case 'saveMarkdown':
				void this.saveMarkdown(message.suggestedName, message.content);
				return;
		}
	}

	/** The view is listening now: hand it what was asked or shown while it was not. */
	public deliverPending(view: ViewChannel): void {
		this.credentialPrompt.resend((message) => view.postMessage(message));
		for (const message of this.listUnshownMarkdown.splice(0)) view.postMessage(message);
	}

	private async saveMarkdown(suggestedName: string, content: string): Promise<void> {
		try {
			const saved = await this.options.rpc('saveFile', suggestedName, content);
			if (typeof saved === 'string') void this.notify.info(`Git Octopus: saved ${saved}.`);
		} catch (error) {
			void this.notify.error(`Git Octopus: could not save the file — ${String(error)}`);
		}
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
		openMergeEditor: (absolutePath: string): Promise<void> =>
			this.editor.openConflictedFile(this.editorSetting(), absolutePath).then(
				() => undefined,
				(error: unknown) => {
					void this.notify.error(`Git Octopus: could not open ${absolutePath} — ${String(error)}`);
				}
			),
		showMarkdown: (content: string): Promise<void> => {
			const message: ShowMarkdownMessage = {
				type: 'showMarkdown',
				title: markdownTitle(content),
				content,
			};
			if (this.setViews.size === 0) this.listUnshownMarkdown.push(message);
			else this.post(message);
			return Promise.resolve();
		},
	};

	private editorSetting(): ExternalEditorSetting {
		return externalEditorFromSettings(this.options.readViewSettings?.() ?? null);
	}

	private async launchTerminal(cwd: string): Promise<void> {
		const run = this.options.runOpen ?? ((listArgs: string[]) => macOpen(...listArgs));
		const chosen = this.options.readViewSettings?.()?.terminalApp;
		const app =
			chosen !== undefined && Object.hasOwn(mapTerminalArgs, chosen) ? chosen : 'Terminal';
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
				await this.editor.openFile(this.editorSetting(), path.join(cwd, filePath));
				return;
			}
			// A file as a commit had it: read out of git into a scratch copy, opened read-only.
			const dir = path.join(this.options.dataDir, 'revisions', hash.slice(0, 12));
			const target = path.join(dir, filePath);
			mkdirSync(path.dirname(target), { recursive: true });
			await new Promise<void>((resolve, reject) => {
				const child = spawn(resolveGitProgram(), ['show', `${hash}:${filePath}`], { cwd });
				const listChunks: Buffer[] = [];
				child.stdout.on('data', (chunk: Buffer) => listChunks.push(chunk));
				child.on('error', reject);
				child.on('close', (code) => {
					if (code !== 0) return reject(new Error(`git show exited with ${code}`));
					writeFileSync(target, Buffer.concat(listChunks), { mode: 0o444 });
					resolve();
				});
			});
			await this.editor.openFile(this.editorSetting(), target);
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
