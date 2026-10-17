// Renders the app icon: `extension/media/icon.svg` at 824 px, centred on a transparent 1024 px canvas
// — the body size macOS's own icons use, so the Dock shows it at the same scale as its neighbours.
// Run after editing the SVG:  pnpm --filter @git-octopus/desktop icon
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const svg = readFileSync(here('../../extension/media/icon.svg'), 'utf8');
const html = `<html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
<img style="width:824px;height:824px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div>
</body></html>`;

// Not a top-level await: an ESM entry that awaits `ready` holds up the very event it waits for.
void app.whenReady().then(async () => {
	const win = new BrowserWindow({
		width: 1024,
		height: 1024,
		show: false,
		transparent: true,
		frame: false,
		webPreferences: { offscreen: true },
	});
	await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
	await sleep(300);
	const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
	writeFileSync(here('../build/icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG());
	app.quit();
});
