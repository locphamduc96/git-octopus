import { expect, test } from '@playwright/test';
import { useDesktopSession, type Session } from '../../src/session.js';
import {
	button,
	closeDiff,
	diff,
	dialog,
	eventually,
	file,
	menu,
	row,
	section,
	toast,
} from '../../src/ui.js';

// 113c: the desktop app's shell around the shared view — the window, its menu, its notices, the
// host process behind it — against the same review repository the VS Code suite uses.
let s: Session;
useDesktopSession((session) => (s = session));

/** Click an item of the app menu bar, as the user would, by its top-level and item labels. */
async function appMenu(top: string, item: string): Promise<void> {
	await s.app.evaluate(
		({ Menu }, { top, item }) => {
			const menuTop = Menu.getApplicationMenu()?.items.find((entry) => entry.label === top);
			menuTop?.submenu?.items.find((entry) => entry.label === item)?.click();
		},
		{ top, item }
	);
}

test('D.1 the folder opens in a window named after its repository and branch', async () => {
	await expect(row(s, 'Uncommitted Changes')).toBeVisible();
	const title = await s.app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].getTitle()
	);
	expect(title).toBe('review — main');
});

test('D.2 a commit opens its details, and a file its diff, inside the window', async () => {
	await row(s, 'docs: title from main').click();
	await file(s.graph.locator('.panel-area'), 'README.md').click();
	await expect(diff(s)).toBeVisible();
	await closeDiff(s);
});

test('D.3 Settings… in the app menu opens the settings, without an editor-only option', async () => {
	await appMenu('Git Octopus', 'Settings…');
	const settings = s.graph.locator('[role="dialog"][aria-label="Settings"]');
	await expect(settings).toBeVisible();
	await expect(settings.getByText('Open diffs in')).toHaveCount(0);
	await button(settings, 'Close settings').click();
});

test('D.4 a copied hash lands on the clipboard and says so inside the window', async () => {
	await menu(s, row(s, 'docs: title from main'), 'Copy Commit Hash');
	await expect(toast(s, 'commit hash copied')).toBeVisible();
	const hash = s.git('log', '-1', '--format=%H', '--grep', 'title from main').trim();
	expect(await s.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(hash);
});

test('D.5 Fetch in the Repository menu runs, with its progress and its notice', async () => {
	await appMenu('Repository', 'Fetch');
	await expect(toast(s, 'fetched from remotes')).toBeVisible();
});

test('D.6 changes are staged and committed from the commit box', async () => {
	await row(s, 'Uncommitted Changes').click();
	await button(s, 'Stage all').click();
	await eventually(() => s.git('diff', '--cached', '--name-only'), /src\/board\.ts/);
	await button(s, 'Commit').click();
	const box = dialog(s, /^Commit \d+ staged file/);
	await box.getByPlaceholder('Short description of the change').fill('feat: from the desktop app');
	await button(box, 'Commit').click();
	await eventually(() => s.git('log', '-1', '--format=%s'), /^feat: from the desktop app$/m);
	await expect(row(s, 'feat: from the desktop app')).toBeVisible();
	await expect(section(s, 'Changes').locator('.file-row')).toHaveCount(0);
});

test('D.7 the window follows macOS between light and dark', async () => {
	const theme = () => s.page.evaluate(() => document.documentElement.dataset.theme);
	await s.app.evaluate(({ nativeTheme }) => {
		nativeTheme.themeSource = 'light';
	});
	await expect.poll(theme).toBe('light');
	await expect(s.page.locator('body.vscode-light')).toHaveCount(1);
	await s.app.evaluate(({ nativeTheme }) => {
		nativeTheme.themeSource = 'dark';
	});
	await expect.poll(theme).toBe('dark');
});

test('D.8 a host that dies is replaced, and the window carries on', async () => {
	const hostPids = () =>
		s.app.evaluate(({ app }) =>
			app
				.getAppMetrics()
				.filter(
					(metric) =>
						metric.type === 'Utility' && (metric.name ?? metric.serviceName) === 'Git Octopus Host'
				)
				.map((metric) => metric.pid)
		);
	const [before] = await hostPids();
	expect(before).toBeGreaterThan(0);
	process.kill(before, 'SIGKILL');
	await expect
		.poll(async () => (await hostPids()).filter((pid) => pid !== before).length, {
			timeout: 20_000,
		})
		.toBe(1);
	await expect(row(s, 'feat: from the desktop app')).toBeVisible({ timeout: 30_000 });
});
