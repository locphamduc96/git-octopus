import { expect, test } from '@playwright/test';
import { useDesktopSession, type Session } from '../../src/session.js';

// 113g: in the desktop app the branches panel is there from the first launch, without the setting.
let s: Session;
useDesktopSession((session) => (s = session));

const panel = () => s.graph.locator('.ref-panel');
const ref = (name: string) => panel().locator(`[role="treeitem"][aria-label="${name}"]`);

test('R.1 the panel is shown by default, with the repository refs', async () => {
	await expect(panel()).toBeVisible();
	await expect(ref('main')).toBeVisible();
	await expect(ref('develop')).toBeVisible();
	await expect(ref('origin/develop')).toBeVisible();
});

test('R.2 the filter narrows the tree to what matches', async () => {
	await panel().getByLabel('Filter refs').fill('tidy');
	await expect(ref('feature/tidy')).toBeVisible();
	await expect(ref('develop')).toHaveCount(0);
	await panel().getByLabel('Filter refs').fill('');
	await expect(ref('develop')).toBeVisible();
});

test('R.3 right-clicking a branch opens the same menu its chip has', async () => {
	await ref('develop').click({ button: 'right' });
	const menu = s.graph.locator('ul.menu');
	await expect(menu.getByRole('button', { name: /Checkout develop/ })).toBeVisible();
	await expect(menu.getByRole('button', { name: /Show Only develop/ })).toBeVisible();
	await s.graph.locator('body').press('Escape');
	await expect(menu).toHaveCount(0);
});

test('R.4 dragging the panel edge resizes it', async () => {
	const area = s.graph.locator('.ref-area');
	const before = (await area.boundingBox())?.width ?? 0;
	const edge = await s.graph.locator('.ref-area + button.splitter').boundingBox();
	expect(edge).not.toBeNull();
	const x = (edge?.x ?? 0) + 1;
	const y = (edge?.y ?? 0) + (edge?.height ?? 0) / 2;
	await s.page.mouse.move(x, y);
	await s.page.mouse.down();
	await s.page.mouse.move(x + 80, y, { steps: 6 });
	await s.page.mouse.up();
	await expect
		.poll(async () => (await area.boundingBox())?.width ?? 0)
		.toBeGreaterThan(before + 40);
});
