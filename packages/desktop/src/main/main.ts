import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron';
import type { HostCommand } from '@git-octopus/shared';
import type { ThemeKind } from '../ipc.js';
import { readAppState, withRecent, writeAppState, type AppState } from './appState.js';
import { adoptLoginShellPath } from './loginShell.js';
import { buildMenu } from './menu.js';
import { renderPage, renderTabsPage } from './page.js';
import { RepoTab } from './repoTab.js';
import { TabbedWindow } from './tabbedWindow.js';

app.setName('Git Octopus');

/** `--user-data-dir=<dir>`: a profile of its own — what the end-to-end tests run against. */
const customDataDir = process.argv
	.find((arg) => arg.startsWith('--user-data-dir='))
	?.slice('--user-data-dir='.length);
if (customDataDir) app.setPath('userData', customDataDir);

const DIST = __dirname;
const dataDir = app.getPath('userData');
const logDir = customDataDir ? path.join(customDataDir, 'logs') : app.getPath('logs');
const appStateFile = path.join(dataDir, 'app.json');
let appState: AppState = readAppState(appStateFile);
let window: TabbedWindow | null = null;
let nextTabId = 1;
let quitting = false;

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const currentTheme = (): ThemeKind => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** `--folder <path>`, once per tab: the folders asked for on the command line. */
function foldersFromArgv(listArgs: string[]): string[] {
	const listFolders: string[] = [];
	for (let i = 0; i < listArgs.length; i++) {
		if (listArgs[i] === '--folder' && listArgs[i + 1]) listFolders.push(listArgs[++i]);
	}
	return listFolders.map((folder) => path.resolve(folder));
}

function isFolder(candidate: string): boolean {
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

function saveState(): void {
	if (window) {
		const active = window.activeTab;
		appState = {
			...appState,
			bounds: window.win.isDestroyed() ? appState.bounds : window.win.getBounds(),
			listOpen: window.tabs.map((tab) => tab.folder),
			activeIndex: active ? window.tabs.indexOf(active) : undefined,
		};
	}
	writeAppState(appStateFile, appState);
}

/** The Dock badge counts the changes of the tab in front, the way Source Control does. */
function updateBadge(): void {
	const count = window?.activeTab?.status.changeCount ?? 0;
	app.dock?.setBadge(count > 0 ? String(count) : '');
}

function refreshMenu(): void {
	Menu.setApplicationMenu(
		buildMenu({
			listRecent: appState.listRecent,
			openFolder: () => void chooseFolder(),
			openRecent: (folder) => openFolder(folder),
			clearRecent: () => {
				appState = { ...appState, listRecent: [] };
				writeAppState(appStateFile, appState);
				refreshMenu();
			},
			closeTab: () => {
				const active = window?.activeTab;
				if (window && active) window.close(active);
			},
			cycleTab: (step) => window?.cycle(step),
			selectTab: (number) => window?.selectNumber(number),
			sendCommand: (command: HostCommand) => window?.activeTab?.sendCommand(command),
			showLogs: () => void shell.openPath(logDir),
		})
	);
}

function ensureWindow(): TabbedWindow {
	if (window) return window;
	const created = new TabbedWindow({
		bounds: appState.bounds,
		theme: currentTheme(),
		tabsPreload: path.join(DIST, 'tabsPreload.js'),
		onChanged: () => {
			saveState();
			updateBadge();
		},
		onClosed: () => {
			window = null;
			updateBadge();
		},
	});
	// Closing the window keeps its tabs for next time; closing the last tab already forgot them.
	created.win.on('close', () => saveState());
	window = created;
	return created;
}

function openFolder(folder: string): void {
	if (!isFolder(folder)) {
		void dialog.showMessageBox({ type: 'warning', message: `${folder} is not a folder.` });
		return;
	}
	const target = ensureWindow();
	const existing = target.tabByFolder(folder);
	if (existing) {
		target.select(existing);
		target.win.focus();
		return;
	}
	const tab = new RepoTab({
		id: nextTabId++,
		folder,
		dataDir,
		logDir,
		theme: currentTheme(),
		hostEntry: path.join(DIST, 'host.js'),
		preload: path.join(DIST, 'preload.js'),
		openFolder: (other) => openFolder(other),
		activate: (which) => {
			target.select(which);
			if (target.win.isMinimized()) target.win.restore();
			target.win.focus();
		},
		onStatus: () => {
			target.refresh();
			updateBadge();
		},
	});
	target.add(tab);
	appState = { ...appState, listRecent: withRecent(appState.listRecent, folder) };
	saveState();
	refreshMenu();
}

async function chooseFolder(): Promise<void> {
	const result = await dialog.showOpenDialog({
		title: 'Open a repository',
		buttonLabel: 'Open',
		properties: ['openDirectory'],
	});
	if (!result.canceled && result.filePaths[0]) openFolder(result.filePaths[0]);
}

/** The tabs that were open, in their order, with the one in front in front again. */
function reopen(listFolders: string[], activeIndex?: number): void {
	for (const folder of listFolders.filter(isFolder)) openFolder(folder);
	const active = activeIndex === undefined ? undefined : window?.tabs[activeIndex];
	if (window && active) window.select(active);
}

app.on('before-quit', () => {
	quitting = true;
	saveState();
});

// A folder dropped on the Dock icon, or `open -a "Git Octopus" <folder>`: a tab of its own.
app.on('open-file', (event, file) => {
	event.preventDefault();
	if (app.isReady()) openFolder(file);
	else app.once('ready', () => openFolder(file));
});

void app.whenReady().then(async () => {
	// Before any host starts: each inherits this process's environment, PATH included.
	await adoptLoginShellPath();
	try {
		mkdirSync(logDir, { recursive: true });
		appendFileSync(
			path.join(logDir, 'main.log'),
			`${new Date().toISOString()} started ${app.getVersion()} — PATH ${process.env.PATH ?? ''}\n`
		);
	} catch {
		// A log that cannot be written must not stop the app.
	}

	protocol.handle('app', (request) => {
		const { pathname } = new URL(request.url);
		const page =
			pathname === '/' || pathname === '/index.html'
				? renderPage(currentTheme())
				: pathname === '/tabs.html'
					? renderTabsPage(currentTheme())
					: null;
		if (page) {
			return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
		}
		// The strip's bundle sits in dist/tabs; everything else is the view's, in dist/renderer.
		const root = pathname.startsWith('/tabs/') ? DIST : path.join(DIST, 'renderer');
		const file = path.join(root, path.normalize(decodeURIComponent(pathname)));
		if (!file.startsWith(root + path.sep) || !existsSync(file)) {
			return new Response(null, { status: 404 });
		}
		return net.fetch(pathToFileURL(file).toString());
	});

	ipcMain.on('git-octopus:ready', (event) => window?.tabByContents(event.sender)?.attachRenderer());
	// The strip's requests are taken from the strip alone: no tab's page can close another tab.
	const fromStrip = (sender: Electron.WebContents): TabbedWindow | null =>
		window && window.win.webContents === sender ? window : null;
	ipcMain.on('tabs:ready', (event) => fromStrip(event.sender)?.pushState());
	ipcMain.on('tabs:select', (event, id: number) => {
		const owner = fromStrip(event.sender);
		const tab = owner?.tabById(id);
		if (owner && tab) owner.select(tab);
	});
	ipcMain.on('tabs:close', (event, id: number) => {
		const owner = fromStrip(event.sender);
		const tab = owner?.tabById(id);
		if (owner && tab) owner.close(tab);
	});
	ipcMain.on('tabs:add', (event) => {
		if (fromStrip(event.sender)) void chooseFolder();
	});
	ipcMain.on('tabs:move', (event, id: number, toIndex: number) => {
		const owner = fromStrip(event.sender);
		const tab = owner?.tabById(id);
		if (owner && tab && Number.isInteger(toIndex)) owner.move(tab, toIndex);
	});
	nativeTheme.on('updated', () => window?.setTheme(currentTheme()));
	refreshMenu();

	const listAsked = foldersFromArgv(process.argv);
	if (listAsked.length > 0) reopen(listAsked);
	else reopen(appState.listOpen, appState.activeIndex);
	if (!window) void chooseFolder();
});

// On a Mac the app stays in the Dock with no window; clicking it brings the last tabs back.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin' && !quitting) app.quit();
});
app.on('activate', () => {
	if (window) return;
	reopen(appState.listOpen, appState.activeIndex);
	if (!window) void chooseFolder();
});
