import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	MessageChannelMain,
	nativeTheme,
	shell,
	utilityProcess,
	WebContentsView,
	type SaveDialogOptions,
	type UtilityProcess,
} from 'electron';
import type { HostCommand } from '@git-octopus/shared';
import type { HostToMain, MainRpc, MainToHost, TabInfo, ThemeKind } from '../ipc.js';
import { parseThemeSource } from '../themeSource.js';

export interface RepoTabOptions {
	id: number;
	folder: string;
	dataDir: string;
	logDir: string;
	theme: ThemeKind;
	/** The compiled host entry and preload, next to this file in `dist/`. */
	hostEntry: string;
	preload: string;
	/** Open a folder in a tab of its own (a worktree). */
	openFolder: (folder: string) => void;
	/** Bring this tab, and its window, to the front. */
	activate: (tab: RepoTab) => void;
	onStatus: (tab: RepoTab) => void;
}

/** Only these leave the app for the browser: a commit's web page, a pull request. */
const LIST_EXTERNAL_SCHEMES = ['https:', 'http:', 'mailto:'];

export const backgroundFor = (theme: ThemeKind): string =>
	theme === 'dark' ? '#1e1e1e' : '#ffffff';

/**
 * One folder in one tab: the view showing it, and the utility process running its host. Main only
 * introduces the two and answers what the host may not do itself; switching tabs hides a view
 * without reloading it, so each keeps its scroll, selection and open dialogs.
 */
export class RepoTab {
	public readonly view: WebContentsView;
	public status: { repoName: string | null; branch: string | null; changeCount: number } = {
		repoName: null,
		branch: null,
		changeCount: 0,
	};
	private host: UtilityProcess;
	private disposed = false;

	public constructor(private readonly options: RepoTabOptions) {
		this.view = new WebContentsView({
			webPreferences: {
				preload: options.preload,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		this.view.setBackgroundColor(backgroundFor(options.theme));
		const contents = this.view.webContents;
		// The view is the only page this tab ever shows; links leave for the browser.
		contents.on('will-navigate', (event) => event.preventDefault());
		contents.setWindowOpenHandler(({ url }) => {
			this.openExternal(url);
			return { action: 'deny' };
		});
		this.host = this.startHost();
		const query = new URLSearchParams({ folder: options.folder });
		void contents.loadURL(`app://git-octopus/index.html?${query.toString()}`);
	}

	public get id(): number {
		return this.options.id;
	}

	public get folder(): string {
		return this.options.folder;
	}

	public get info(): TabInfo {
		return {
			id: this.id,
			title: this.status.repoName ?? path.basename(this.folder),
			branch: this.status.branch,
			changeCount: this.status.changeCount,
			folder: this.folder,
		};
	}

	/** The renderer is listening: give it and the host a channel of their own. */
	public attachRenderer(): void {
		const { port1, port2 } = new MessageChannelMain();
		this.host.postMessage({ kind: 'view' } satisfies MainToHost, [port1]);
		this.view.webContents.postMessage('git-octopus:port', null, [port2]);
	}

	/** On screen and in front, or not: the host refreshes for nobody while its tab is hidden. */
	public setShown(shown: boolean, windowFocused: boolean): void {
		this.view.setVisible(shown);
		this.toHost({ kind: 'visible', visible: shown });
		this.toHost({ kind: 'focus', focused: shown && windowFocused });
	}

	public setFocused(focused: boolean): void {
		this.toHost({ kind: 'focus', focused });
	}

	public setTheme(theme: ThemeKind): void {
		this.toHost({ kind: 'theme', theme });
		this.view.webContents.send('git-octopus:theme', theme);
		this.view.setBackgroundColor(backgroundFor(theme));
	}

	/** A menu item or shortcut, for the view to run as if its own key had been pressed. */
	public sendCommand(command: HostCommand): void {
		this.view.webContents.send('git-octopus:command', command);
	}

	public dispose(): void {
		this.disposed = true;
		this.host.kill();
		this.view.webContents.close();
	}

	private toHost(message: MainToHost): void {
		this.host.postMessage(message);
	}

	private startHost(): UtilityProcess {
		const host = utilityProcess.fork(this.options.hostEntry, [], {
			serviceName: 'Git Octopus Host',
			stdio: 'inherit',
		});
		host.on('message', (message: HostToMain) => this.fromHost(message));
		// A host that dies takes nothing else with it: a new one starts, and the view reloads to meet it.
		host.on('exit', () => {
			if (this.disposed || this.view.webContents.isDestroyed()) return;
			this.host = this.startHost();
			this.view.webContents.reload();
		});
		host.postMessage({
			kind: 'init',
			folder: this.options.folder,
			dataDir: this.options.dataDir,
			logDir: this.options.logDir,
			theme: this.options.theme,
			focused: false,
			appBinary: process.execPath,
		} satisfies MainToHost);
		return host;
	}

	private fromHost(message: HostToMain): void {
		if (message.kind === 'status') {
			this.status = {
				repoName: message.repoName,
				branch: message.branch,
				changeCount: message.changeCount,
			};
			this.options.onStatus(this);
			return;
		}
		void this.answer(message.method, message.args)
			.then((value) => this.toHost({ kind: 'rpcResult', id: message.id, ok: true, value }))
			.catch((error: unknown) =>
				this.toHost({
					kind: 'rpcResult',
					id: message.id,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				})
			);
	}

	private async answer(method: keyof MainRpc, listArgs: unknown[]): Promise<unknown> {
		switch (method) {
			case 'writeClipboard':
				clipboard.writeText(String(listArgs[0]));
				return undefined;
			case 'openExternal':
				this.openExternal(String(listArgs[0]));
				return undefined;
			case 'openFolderWindow':
				this.options.openFolder(String(listArgs[0]));
				return undefined;
			case 'focusWindow':
				this.options.activate(this);
				return undefined;
			case 'setThemeSource':
				nativeTheme.themeSource = parseThemeSource(listArgs[0]);
				return undefined;
			case 'saveFile':
				return this.saveFile(String(listArgs[0]), String(listArgs[1]));
		}
	}

	/** Asks where, writes there, answers the path; a cancelled dialog answers nothing. */
	private async saveFile(suggestedName: string, content: string): Promise<string | undefined> {
		const name = path.basename(suggestedName).replace(/[\\/:*?"<>|]/g, '-') || 'explanation.md';
		const options: SaveDialogOptions = {
			title: 'Save as',
			defaultPath: path.join(app.getPath('documents'), name),
			filters: [{ name: 'Markdown', extensions: ['md'] }],
		};
		const owner = BrowserWindow.fromWebContents(this.view.webContents);
		const result = owner
			? await dialog.showSaveDialog(owner, options)
			: await dialog.showSaveDialog(options);
		if (result.canceled || !result.filePath) return undefined;
		await writeFile(result.filePath, content, 'utf8');
		return result.filePath;
	}

	private openExternal(url: string): void {
		try {
			if (LIST_EXTERNAL_SCHEMES.includes(new URL(url).protocol)) void shell.openExternal(url);
		} catch {
			// Not a URL: nothing to open.
		}
	}
}
