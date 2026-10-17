import * as path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pageAt, useDesktopSession, type Session } from '../../src/session.js';
import { row } from '../../src/ui.js';

// 113h: tabs across the top of the window, as in GitKraken — one repository each, each view kept
// alive while another is in front. The second folder is the fixture's own worktree.
let s: Session;
useDesktopSession((session) => (s = session));

const strip = (): Page => s.tabs as Page;
const tabNames = (): Promise<string[]> => strip().locator('.tab .name').allInnerTexts();
const activeName = (): Promise<string> => strip().locator('.tab.active .name').innerText();
const tab = (name: string): Locator =>
	strip().locator('.tab', { has: strip().locator('.name', { hasText: new RegExp(`^${name}$`) }) });
const hostCount = (): Promise<number> =>
	s.app.evaluate(
		({ app }) =>
			app
				.getAppMetrics()
				.filter(
					(metric) =>
						metric.type === 'Utility' && (metric.name ?? metric.serviceName) === 'Git Octopus Host'
				).length
	);
/** As if the folder had been dropped on the Dock icon. */
const openInApp = (folder: string): Promise<void> =>
	s.app.evaluate(({ app }, folder) => {
		app.emit('open-file', { preventDefault: () => undefined }, folder);
	}, folder);
const menuItem = (top: string, label: string): Promise<void> =>
	s.app.evaluate(
		({ Menu }, { top, label }) => {
			const menu = Menu.getApplicationMenu()?.items.find((entry) => entry.label === top);
			menu?.submenu?.items.find((entry) => entry.label === label)?.click();
		},
		{ top, label }
	);
const windowTitle = (): Promise<string> =>
	s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
/** The view of the worktree's tab, driven with the same helpers as the first. */
let second: Session;

test('T.1 a second folder opens in a tab of its own, in front', async () => {
	await expect.poll(tabNames).toEqual(['review']);
	await openInApp(path.join(s.root, 'review-wt'));
	await expect.poll(tabNames).toEqual(['review', 'review-wt']);
	expect(await activeName()).toBe('review-wt');
	const page = await pageAt(s.app, '/index.html', 'review-wt');
	second = { ...s, page, graph: page };
	await expect(page.locator('button.ref').first()).toBeVisible();
	await expect.poll(windowTitle).toMatch(/^review-wt — /);
	expect(await hostCount()).toBe(2);
});

test('T.2 each tab keeps its own view while another is in front', async () => {
	await row(second, 'docs: explain scoring').click();
	await tab('review').click();
	await expect.poll(activeName).toBe('review');
	await expect.poll(windowTitle).toBe('review — main');
	await row(s, 'feat: tidy the menu').click();
	await tab('review-wt').click();
	await expect.poll(activeName).toBe('review-wt');
	await expect(second.graph.locator('.row.selected')).toContainText('explain scoring');
	await expect(s.graph.locator('.row.selected')).toContainText('tidy the menu');
});

test('T.3 tabs change from the Window menu and its shortcuts', async () => {
	await menuItem('Window', 'Show Previous Tab');
	await expect.poll(activeName).toBe('review');
	await menuItem('Window', 'Tab 2');
	await expect.poll(activeName).toBe('review-wt');
	await menuItem('Window', 'Show Next Tab');
	await expect.poll(activeName).toBe('review');
});

test('T.4 a tab is dragged to another place in the strip', async () => {
	const from = tab('review-wt');
	const to = tab('review');
	const dataTransfer = await from.evaluateHandle(() => new DataTransfer());
	const box = await to.boundingBox();
	const at = { clientX: (box?.x ?? 0) + 4, clientY: (box?.y ?? 0) + 10 };
	await from.dispatchEvent('dragstart', { dataTransfer });
	await to.dispatchEvent('dragover', { dataTransfer, ...at });
	await to.dispatchEvent('drop', { dataTransfer, ...at });
	await from.dispatchEvent('dragend', { dataTransfer });
	await expect.poll(tabNames).toEqual(['review-wt', 'review']);
});

test('T.5 closing a tab ends its host and brings a neighbour forward', async () => {
	await tab('review-wt').getByRole('button', { name: 'Close review-wt' }).click();
	await expect.poll(tabNames).toEqual(['review']);
	expect(await activeName()).toBe('review');
	await expect.poll(hostCount).toBe(1);
	await expect(row(s, 'Uncommitted Changes')).toBeVisible();
});
