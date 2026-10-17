import * as path from 'node:path';
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { HostCommand } from '@git-octopus/shared';

export interface MenuActions {
	listRecent: string[];
	/** Ask for a folder and open it in a new tab. */
	openFolder: () => void;
	openRecent: (folder: string) => void;
	clearRecent: () => void;
	closeTab: () => void;
	cycleTab: (step: number) => void;
	selectTab: (number: number) => void;
	/** Run on the view of the tab in front. */
	sendCommand: (command: HostCommand) => void;
	showLogs: () => void;
}

/** Menu items that only carry a second shortcut for something already in the menu. */
const hidden = (item: MenuItemConstructorOptions): MenuItemConstructorOptions => ({
	...item,
	visible: false,
	acceleratorWorksWhenHidden: true,
});

/**
 * The macOS menu bar. The Edit menu is not decoration: without its roles, ⌘C and ⌘V do nothing in
 * the view's text fields. Repository items carry the shortcuts the view knows — the view takes the
 * key first when it has focus, and the menu catches it otherwise. Tabs move as in a browser.
 */
export function buildMenu(actions: MenuActions): Menu {
	const recent: MenuItemConstructorOptions[] =
		actions.listRecent.length > 0
			? [
					...actions.listRecent.map((folder) => ({
						label: path.basename(folder),
						sublabel: folder,
						click: () => actions.openRecent(folder),
					})),
					{ type: 'separator' },
					{ label: 'Clear Recent', click: actions.clearRecent },
				]
			: [{ label: 'No Recent Folders', enabled: false }];
	const listNumbered: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) =>
		hidden({
			label: `Tab ${i + 1}`,
			accelerator: `CmdOrCtrl+${i + 1}`,
			click: () => actions.selectTab(i + 1),
		})
	);
	const template: MenuItemConstructorOptions[] = [
		{
			label: app.name,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{
					label: 'Settings…',
					accelerator: 'CmdOrCtrl+,',
					click: () => actions.sendCommand('openSettings'),
				},
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{
			label: 'File',
			submenu: [
				{ label: 'New Tab…', accelerator: 'CmdOrCtrl+T', click: actions.openFolder },
				{ label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: actions.openFolder },
				{ label: 'Open Recent', submenu: recent },
				{ type: 'separator' },
				{ label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: actions.closeTab },
			],
		},
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
				...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
		{
			label: 'Repository',
			submenu: [
				{
					label: 'Refresh',
					accelerator: 'CmdOrCtrl+R',
					click: () => actions.sendCommand('refresh'),
				},
				{ label: 'Fetch', accelerator: 'CmdOrCtrl+L', click: () => actions.sendCommand('fetch') },
				{
					label: 'New Branch…',
					accelerator: 'CmdOrCtrl+B',
					click: () => actions.sendCommand('createBranch'),
				},
			],
		},
		{
			label: 'Window',
			role: 'window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
				{ type: 'separator' },
				{ label: 'Show Next Tab', accelerator: 'Ctrl+Tab', click: () => actions.cycleTab(1) },
				{
					label: 'Show Previous Tab',
					accelerator: 'Ctrl+Shift+Tab',
					click: () => actions.cycleTab(-1),
				},
				hidden({
					label: 'Next Tab',
					accelerator: 'CmdOrCtrl+Shift+]',
					click: () => actions.cycleTab(1),
				}),
				hidden({
					label: 'Previous Tab',
					accelerator: 'CmdOrCtrl+Shift+[',
					click: () => actions.cycleTab(-1),
				}),
				...listNumbered,
				{ type: 'separator' },
				{ role: 'front' },
			],
		},
		{ role: 'help', submenu: [{ label: 'Show Logs', click: actions.showLogs }] },
	];
	return Menu.buildFromTemplate(template);
}
