import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	app,
	BrowserWindow,
	ipcMain,
	MessageChannelMain,
	net,
	protocol,
	utilityProcess,
} from 'electron';
import { SPIKE_THEME_CSS } from './theme';

/**
 * Spike for feature-113a: the real webview in an Electron window, fed by a read-only host running
 * in its own utility process. Only what measuring needs — no menus, no writes, no persistence.
 */
const MEDIA_ROOT = path.resolve(__dirname, '../../../extension/media/webview');
const CSP = [
	`default-src 'none'`,
	`img-src app: https: data:`,
	`font-src app:`,
	`style-src app: 'unsafe-inline'`,
	`script-src app:`,
].join('; ');
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<link rel="stylesheet" href="app://git-octopus/webview.css" />
<style>${SPIKE_THEME_CSS}</style>
<title>Git Octopus</title>
</head>
<body class="vscode-dark">
<div id="app"></div>
<script type="module" src="app://git-octopus/webview.js"></script>
</body>
</html>`;

function argValue(name: string): string | undefined {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
}

const repo = argValue('--repo') ?? process.cwd();

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

void app.whenReady().then(() => {
	protocol.handle('app', (request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/' || pathname === '/index.html') {
			return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
		}
		const file = path.join(MEDIA_ROOT, path.normalize(decodeURIComponent(pathname)));
		if (!file.startsWith(MEDIA_ROOT + path.sep)) return new Response(null, { status: 404 });
		return net.fetch(pathToFileURL(file).toString());
	});

	const host = utilityProcess.fork(path.join(__dirname, 'host.js'), ['--repo', repo], {
		serviceName: 'Git Octopus Host',
		stdio: 'inherit',
	});
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		backgroundColor: '#1e1e1e',
		title: 'Git Octopus',
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	// The renderer and the host talk directly; main only hands each one its end of the channel.
	ipcMain.once('git-octopus:ready', (event) => {
		const { port1, port2 } = new MessageChannelMain();
		host.postMessage('port', [port1]);
		event.sender.postMessage('git-octopus:port', null, [port2]);
	});
	void win.loadURL('app://git-octopus/index.html');
	win.on('closed', () => host.kill());
});

app.on('window-all-closed', () => app.quit());
