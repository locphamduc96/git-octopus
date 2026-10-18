import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { WelcomeApi, WelcomeState } from './welcome/api.js';

/** The Welcome page's whole reach: the state main sends, and four requests back. */
const api: WelcomeApi = {
	onState: (listener) =>
		void ipcRenderer.on('welcome:state', (_event, state: WelcomeState) => listener(state)),
	openDialog: () => ipcRenderer.send('welcome:open-dialog'),
	openRecent: (folder) => ipcRenderer.send('welcome:open-recent', folder),
	removeRecent: (folder) => ipcRenderer.send('welcome:remove-recent', folder),
	openDropped: (file) => {
		const folder = webUtils.getPathForFile(file);
		if (folder) ipcRenderer.send('welcome:open-dropped', folder);
	},
};
contextBridge.exposeInMainWorld('gitOctopusWelcome', api);

window.addEventListener('DOMContentLoaded', () => ipcRenderer.send('welcome:ready'));
