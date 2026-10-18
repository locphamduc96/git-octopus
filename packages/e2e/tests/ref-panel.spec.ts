import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { answer, button, dialog, eventually, head } from '../src/ui.js';

// 113g: the branches panel beside the graph. The extension leaves it off until the setting asks for
// it; the desktop app's own suite covers it being on from the start.
let s: Session;
useSession((session) => (s = session));

const settings = () => s.graph.locator('[role="dialog"][aria-label="Settings"]');
const panel = () => s.graph.locator('.ref-panel');
// The panel's own selected row shares the class, so the graph's is told apart by its scroller.
const graphSelected = () => s.graph.locator('.scroll .row.selected');
const ref = (name: string) => panel().locator(`[role="treeitem"][aria-label="${name}"]`);

test('P.1 the panel is off until the setting turns it on', async () => {
	await expect(panel()).toHaveCount(0);
	await button(s, 'Settings').click();
	await settings().getByLabel('Show branches panel').check();
	await button(settings(), 'Close settings').click();
	await expect(settings()).toHaveCount(0);
	await expect(panel()).toBeVisible();
	await expect(ref('develop')).toBeVisible();
	await expect(ref('origin/develop')).toBeVisible();
});

test('P.2 clicking a branch brings its commit forward in the graph', async () => {
	await ref('develop').click();
	await expect(graphSelected()).toContainText('explain scoring');
	await ref('origin/release').click();
	await expect(graphSelected()).toContainText('import level data');
});

test('P.3 double-clicking a branch checks it out', async () => {
	// feature/tidy leaves src/board.ts alone, so the uncommitted edit can travel with the checkout.
	await ref('feature/tidy').dblclick();
	await expect(dialog(s, 'Check out branch')).toContainText('uncommitted changes');
	await answer(s, 'Check out');
	await eventually(() => head(s), 'feature/tidy');
	await expect(ref('feature/tidy')).toHaveAttribute('aria-current', 'true');
	await ref('main').dblclick();
	await answer(s, 'Check out');
	await eventually(() => head(s), 'main');
});
