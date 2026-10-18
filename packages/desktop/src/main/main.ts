import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron';
import type { HostCommand } from '@git-octopus/shared';
import type { ThemeKind } from '../ipc.js';
import { readStoredThemeSource } from '../themeSource.js';
import { renderWelcomePage } from '../welcome/page.js';
import {
	isExistingFolder,
	readAppState,
	withRecent,
	withoutMissing,
	withoutRecent,
	writeAppState,
	type AppState,
} from './appState.js';
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

/** The recent list as it stands, folders that were moved or deleted already dropped from it. */
function recentFolders(): string[] {
	const listKept = withoutMissing(appState.listRecent);
	if (listKept.length !== appState.listRecent.length) {
		appState = { ...appState, listRecent: listKept };
		writeAppState(appStateFile, appState);
	}
	return appState.listRecent;
}

/** The list changed: remembered, and shown in the menu and on the Welcome page. */
function changeRecent(listRecent: string[]): void {
	appState = { ...appState, listRecent };
	saveState();
	refreshMenu();
	window?.pushWelcome();
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
			listRecent: recentFolders(),
			openFolder: () => void chooseFolder(),
			openRecent: (folder) => openFolder(folder),
			clearRecent: () => changeRecent([]),
			closeTab: () => {
				const active = window?.activeTab;
				if (window && active) window.close(active);
				else window?.win.close();
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
		welcomePreload: path.join(DIST, 'welcomePreload.js'),
		recent: recentFolders,
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
	if (!isExistingFolder(folder)) {
		changeRecent(withoutRecent(appState.listRecent, folder));
		void dialog.showMessageBox({ type: 'warning', message: `${folder} is not a folder.` });
		return;
	}
	changeRecent(withRecent(appState.listRecent, folder));
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
	saveState();
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
	for (const folder of listFolders.filter(isExistingFolder)) openFolder(folder);
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
	// Before any window opens, so the first paint is already in the theme the user chose.
	nativeTheme.themeSource = readStoredThemeSource(path.join(dataDir, 'state.json'));
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
					: pathname === '/welcome.html'
						? renderWelcomePage(currentTheme())
						: null;
		if (page) {
			return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
		}
		// The strip's and the Welcome page's bundles sit in dist/tabs and dist/welcome; everything
		// else is the view's, in dist/renderer.
		const root =
			pathname.startsWith('/tabs/') || pathname.startsWith('/welcome/')
				? DIST
				: path.join(DIST, 'renderer');
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
	// The Welcome page's requests are taken from that page alone, like the strip's.
	const fromWelcome = (sender: Electron.WebContents): boolean => !!window?.isWelcome(sender);
	ipcMain.on('welcome:ready', (event) => {
		if (fromWelcome(event.sender)) window?.pushWelcome();
	});
	ipcMain.on('welcome:open-dialog', (event) => {
		if (fromWelcome(event.sender)) void chooseFolder();
	});
	ipcMain.on('welcome:open-recent', (event, folder: unknown) => {
		if (fromWelcome(event.sender) && typeof folder === 'string') openFolder(folder);
	});
	ipcMain.on('welcome:remove-recent', (event, folder: unknown) => {
		if (fromWelcome(event.sender) && typeof folder === 'string') {
			changeRecent(withoutRecent(appState.listRecent, folder));
		}
	});
	ipcMain.on('welcome:open-dropped', (event, folder: unknown) => {
		if (fromWelcome(event.sender) && typeof folder === 'string') openFolder(folder);
	});
	nativeTheme.on('updated', () => window?.setTheme(currentTheme()));
	refreshMenu();

	const listAsked = foldersFromArgv(process.argv);
	if (listAsked.length > 0) reopen(listAsked);
	else reopen(appState.listOpen, appState.activeIndex);
	if (!window) ensureWindow().showWelcome();
});

// On a Mac the app stays in the Dock with no window; clicking it brings the last tabs back.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin' && !quitting) app.quit();
});
app.on('activate', () => {
	if (window) return;
	reopen(appState.listOpen, appState.activeIndex);
	if (!window) ensureWindow().showWelcome();
});
