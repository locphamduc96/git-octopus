import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { pageAt, useDesktopSession, type Session } from '../../src/session.js';

// 113d-5: a window with no tab left shows the Welcome page — Open Repository…, the recent
// repositories (each removable) and a folder to drop — instead of closing.
let s: Session;
useDesktopSession((session) => (s = session));

const strip = (): Page => s.tabs as Page;
const tabNames = (): Promise<string[]> => strip().locator('.tab .name').allInnerTexts();
const openInApp = (folder: string): Promise<void> =>
	s.app.evaluate(({ app }, folder) => {
		app.emit('open-file', { preventDefault: () => undefined }, folder);
	}, folder);
const windowCount = (): Promise<number> =>
	s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const closeTab = (name: string): Promise<void> =>
	strip()
		.getByRole('button', { name: `Close ${name}` })
		.click();
/** The screenshot after each test is taken of `s.page`, which has to be a page still open. */
const follow = (page: Page): void => {
	s.page = page;
	s.graph = page;
};
const recentNames = (page: Page): Promise<string[]> => page.locator('.item .name').allInnerTexts();
const savedRecent = async (): Promise<string[]> => {
	const userData = await s.app.evaluate(({ app }) => app.getPath('userData'));
	const saved = JSON.parse(readFileSync(path.join(userData, 'app.json'), 'utf8')) as {
		listRecent: string[];
	};
	return saved.listRecent.map((folder) => path.basename(folder));
};

let welcome: Page;

test('W.1 closing the last tab leaves the window on the Welcome page', async () => {
	await expect.poll(tabNames).toEqual(['review']);
	const view = s.page;
	await closeTab('review');
	welcome = await pageAt(s.app, '/welcome.html');
	follow(welcome);
	await expect.poll(tabNames).toEqual([]);
	await expect(welcome.getByRole('button', { name: 'Open Repository…' })).toBeVisible();
	expect(await windowCount()).toBe(1);
	expect(view.isClosed()).toBe(true);
	await expect.poll(() => recentNames(welcome)).toEqual(['review']);
});

test('W.2 a recent repository opens in a tab and the Welcome page goes away', async () => {
	await welcome.getByRole('button', { name: 'Open review', exact: true }).click();
	await expect.poll(tabNames).toEqual(['review']);
	const view = await pageAt(s.app, '/index.html', 'review');
	follow(view);
	await expect(view.locator('button.ref').first()).toBeVisible();
	await expect.poll(() => welcome.isClosed()).toBe(true);
});

test('W.3 a recent repository is removed from the list and from the saved state', async () => {
	await openInApp(path.join(s.root, 'review-wt'));
	await expect.poll(tabNames).toEqual(['review', 'review-wt']);
	await closeTab('review-wt');
	await closeTab('review');
	welcome = await pageAt(s.app, '/welcome.html');
	follow(welcome);
	await expect.poll(() => recentNames(welcome)).toEqual(['review-wt', 'review']);

	const item = welcome.locator('.item', { hasText: 'review-wt' });
	await item.hover();
	await item.getByRole('button', { name: 'Remove review-wt from recent' }).click();
	await expect.poll(() => recentNames(welcome)).toEqual(['review']);
	expect(await savedRecent()).toEqual(['review']);
});
