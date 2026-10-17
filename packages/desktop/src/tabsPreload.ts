import { contextBridge, ipcRenderer } from 'electron';
import type { TabsApi, TabsState } from './ipc.js';

/** The tab strip's whole reach: the state main sends, and four requests back. */
const api: TabsApi = {
	onState: (listener) =>
		void ipcRenderer.on('tabs:state', (_event, state: TabsState) => listener(state)),
	select: (id) => ipcRenderer.send('tabs:select', id),
	close: (id) => ipcRenderer.send('tabs:close', id),
	add: () => ipcRenderer.send('tabs:add'),
	move: (id, toIndex) => ipcRenderer.send('tabs:move', id, toIndex),
};
contextBridge.exposeInMainWorld('gitOctopusTabs', api);

window.addEventListener('DOMContentLoaded', () => ipcRenderer.send('tabs:ready'));
