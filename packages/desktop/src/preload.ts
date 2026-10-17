import { contextBridge, ipcRenderer } from 'electron';

/**
 * Everything the page may reach: three calls, shaped like the ones VS Code gives a webview, each
 * value crossing as JSON text (the bridge structured-clones its arguments, and the view's `$state`
 * proxies cannot be). Messages from the host arrive as window messages — what the view's
 * `onHostMessage` already listens for.
 */
let port: MessagePort | null = null;
const listPending: unknown[] = [];
/** The view's own state, per folder: it survives a reload of the window, as a webview's does. */
const stateKey = `view-state:${new URLSearchParams(location.search).get('folder') ?? ''}`;

ipcRenderer.on('git-octopus:port', (event) => {
	port = event.ports[0];
	port.onmessage = (message) => window.postMessage(message.data, '*');
	for (const message of listPending.splice(0)) port.postMessage(message);
});

// A menu item or its shortcut: handed to the view as the keybinding VS Code would have sent.
ipcRenderer.on('git-octopus:command', (_event, command: string) =>
	window.postMessage({ type: 'hostCommand', command }, '*')
);

ipcRenderer.on('git-octopus:theme', (_event, theme: 'light' | 'dark') => {
	document.body.classList.toggle('vscode-dark', theme === 'dark');
	document.body.classList.toggle('vscode-light', theme === 'light');
	document.documentElement.dataset.theme = theme;
});

contextBridge.exposeInMainWorld('gitOctopusHost', {
	post(json: string): void {
		const message: unknown = JSON.parse(json);
		if (port) port.postMessage(message);
		else listPending.push(message);
	},
	getState: (): string | null => localStorage.getItem(stateKey),
	setState(json: string): void {
		localStorage.setItem(stateKey, json);
	},
});

ipcRenderer.send('git-octopus:ready');
