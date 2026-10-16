import { contextBridge, ipcRenderer } from 'electron';

/**
 * The webview was written against `acquireVsCodeApi`: hand it the same three calls, backed by a
 * MessagePort to the host instead of VS Code's channel. Replies arrive as window messages, which is
 * what its `onHostMessage` already listens for.
 *
 * Everything crosses the context bridge as JSON text. The bridge structured-clones its arguments,
 * and the view hands `setState` objects that still hold Svelte `$state` proxies — which cannot be
 * cloned, while VS Code's own API serialises them without complaint.
 */
let port: MessagePort | null = null;
const listPending: unknown[] = [];
let stateJson: string | null = null;

ipcRenderer.on('git-octopus:port', (event) => {
	port = event.ports[0];
	port.onmessage = (message) => window.postMessage(message.data, '*');
	for (const message of listPending.splice(0)) port.postMessage(message);
});
ipcRenderer.send('git-octopus:ready');

contextBridge.exposeInMainWorld('gitOctopusBridge', {
	post(json: string): void {
		const message: unknown = JSON.parse(json);
		if (port) port.postMessage(message);
		else listPending.push(message);
	},
	getState: (): string | null => stateJson,
	setState(json: string): void {
		stateJson = json;
	},
});

contextBridge.executeInMainWorld({
	func: () => {
		const bridge = (window as unknown as Record<string, Record<string, (json?: string) => unknown>>)
			.gitOctopusBridge;
		(window as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
			postMessage: (message: unknown) => bridge.post(JSON.stringify(message)),
			getState: () => {
				const json = bridge.getState() as string | null;
				return json ? JSON.parse(json) : undefined;
			},
			setState: (state: unknown) => bridge.setState(JSON.stringify(state)),
		});
	},
});
