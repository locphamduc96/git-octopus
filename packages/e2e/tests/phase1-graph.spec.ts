import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import {
	answer,
	chip,
	dialog,
	eventually,
	head,
	menu,
	nodeX,
	row,
	selectedRow,
} from '../src/ui.js';

// Phase 0–1 of the smoke checklist: reading the graph. Nothing here changes the repository except
// 1.8, which checks a branch out and back.
let s: Session;
useSession((session) => (s = session));

test('0.2 opens the graph on the review repository', async () => {
	for (const name of [
		'main',
		'develop',
		'feature/picks',
		'feature/rebase-me',
		'conflict/incoming',
	]) {
		await expect(chip(s, name)).toBeVisible();
	}
	await expect(row(s, 'Uncommitted Changes')).toBeVisible();
});

test('1.1 keys walk the graph, and ? lists them', async () => {
	await row(s, 'rebase-me: step 2').click();
	await expect(selectedRow(s)).toContainText('rebase-me: step 2');
	await s.page.keyboard.press('Alt+ArrowUp');
	await expect(selectedRow(s)).toContainText('rebase-me: step 3');
	// The tip of its lane: one more step along it goes nowhere.
	await s.page.keyboard.press('Alt+ArrowUp');
	await expect(selectedRow(s)).toContainText('rebase-me: step 3');
	await s.page.keyboard.press('ArrowDown');
	await expect(selectedRow(s)).not.toContainText('rebase-me: step 3');
	await s.page.keyboard.press('Shift+Slash');
	await expect(s.graph.locator('[role="dialog"][aria-label="Keyboard shortcuts"]')).toBeVisible();
	await s.page.keyboard.press('Escape');
	await expect(s.graph.locator('[role="dialog"]')).toHaveCount(0);
});

test('1.2 find highlights, steps, and filters only when asked', async () => {
	// Rows are virtualised, so the graph staying whole is read off a row that does not match.
	const nonMatching = row(s, 'docs: explain scoring');
	await s.graph.getByRole('button', { name: 'Find commits' }).click();
	const input = s.graph.getByPlaceholder('Find commits…');
	await input.fill('pick');
	await expect(s.graph.locator('.row.find-match')).toHaveCount(4);
	await expect(nonMatching).toBeVisible();
	await input.press('Enter');
	await expect(s.graph.locator('.find .count')).toHaveText(/^\d\/4$/);
	await expect(s.graph.locator('.row.find-current')).toContainText(/pick (one|two|three|four)/);
	await s.graph.getByRole('button', { name: 'Use regular expression' }).click();
	await input.fill('^feat\\(merged');
	await expect(s.graph.locator('.row.find-match')).toHaveCount(2);
	await s.graph.getByRole('button', { name: 'Show only matching commits' }).click();
	await expect(s.graph.locator('.row')).toHaveCount(2);
	await expect(nonMatching).toHaveCount(0);
	await s.graph.getByRole('button', { name: 'Close find' }).click();
	await expect(nonMatching).toBeVisible();
});

test('1.3 the Changes column shows lines added and removed', async () => {
	await menu(s, s.graph.locator('.hcell', { hasText: 'Description' }), 'Changes');
	await expect(row(s, 'chore: import level data').locator('.changes')).toContainText('+1500');
	await expect(row(s, 'chore: import level data').locator('.changes')).toContainText('−0');
	// A merge counts what it brought in: two one-line files.
	await expect(row(s, "Merge branch 'feature/merged'").locator('.changes')).toContainText('+2');
	await expect(row(s, 'Uncommitted Changes').locator('.changes')).toHaveText('—');
});

test('1.4 a column header dragged onto another moves the column', async () => {
	await menu(s, s.graph.locator('.hcell', { hasText: 'Description' }), 'Author');
	const labels = () => s.graph.locator('.hlabel.movable').allInnerTexts();
	await expect.poll(labels).toEqual(['Author', 'Date', 'Changes']);
	await s.graph
		.locator('.hlabel.movable', { hasText: 'Changes' })
		.dragTo(s.graph.locator('.hcell', { has: s.graph.locator('.hlabel', { hasText: 'Author' }) }));
	await expect.poll(labels).toEqual(['Changes', 'Author', 'Date']);
});

test('1.5 a merge commit lists only the files it brought in', async () => {
	await row(s, "Merge branch 'feature/merged'").click();
	// The working tree's list stays mounted behind the commit's; only what is shown counts.
	const files = s.graph.locator('.file-row').filter({ visible: true });
	await expect(files).toHaveCount(2);
	await expect(files.nth(0)).toContainText('a.txt');
	await expect(files.nth(1)).toContainText('b.txt');
});

test('1.6 pinning a branch moves its line to the left edge', async () => {
	const developTip = row(s, 'docs: explain scoring');
	const mainTip = row(s, 'docs: title from main');
	expect(await nodeX(developTip)).toBeGreaterThan(await nodeX(mainTip));
	await menu(s, chip(s, 'develop'), 'Pin develop to Left');
	await expect(s.graph.getByRole('button', { name: 'Jump to the pinned branch' })).toBeVisible();
	await expect.poll(async () => (await nodeX(developTip)) < (await nodeX(mainTip))).toBe(true);
	await menu(s, chip(s, 'develop'), 'Unpin develop from Left');
	await expect(s.graph.getByRole('button', { name: 'Jump to the pinned branch' })).toHaveCount(0);
});

test('1.7 hide, show only and related narrow the graph, and the pill undoes it', async () => {
	const pill = s.graph.locator('.filter-pill');
	await menu(s, chip(s, 'noisy/experiment'), 'Hide noisy/experiment');
	await expect(row(s, 'spike: canvas try 3')).toHaveCount(0);
	await expect(pill).toContainText('1 hidden');
	await pill.click();
	await expect(row(s, 'spike: canvas try 3')).toBeVisible();

	await menu(s, chip(s, 'feature/picks'), 'Show Only feature/picks');
	await expect(row(s, 'docs: explain scoring')).toHaveCount(0);
	await expect(row(s, 'feat: pick four')).toBeVisible();
	await menu(s, chip(s, 'scratch'), 'Also Show scratch');
	await expect(pill).toContainText('feature/picks, scratch');
	await pill.click();
	await expect(row(s, 'docs: explain scoring')).toBeVisible();

	await menu(s, chip(s, 'main'), 'Show Only Related Branches');
	await expect(row(s, 'docs: explain scoring')).toHaveCount(0);
	await expect(row(s, 'docs: title from main')).toBeVisible();
	await pill.click();
	await expect(row(s, 'docs: explain scoring')).toBeVisible();
});

test('1.8 double-clicking the faded branch name checks that branch out', async () => {
	// feature/tidy leaves src/board.ts alone, so the uncommitted edit can travel with the checkout.
	await row(s, 'wip').click();
	await row(s, 'wip').locator('button.ghost', { hasText: 'feature/tidy' }).dblclick();
	// The tree is dirty, so the checkout says what will travel with it before it runs.
	await expect(dialog(s, 'Check out branch')).toContainText('3 uncommitted changes');
	await answer(s, 'Check out');
	await eventually(() => head(s), 'feature/tidy');
	expect(s.git('status', '--porcelain')).toContain(' M src/board.ts');
	await chip(s, 'main').dblclick();
	await answer(s, 'Check out');
	await eventually(() => head(s), 'main');
});
