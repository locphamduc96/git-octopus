import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, chip, confirm, dialog, eventually, menu, reachChip } from '../src/ui.js';

// Phase 6 of the smoke checklist: remotes, upstreams and worktrees. The fixture leaves one worktree
// holding wt/elsewhere and one whose folder is gone.
let s: Session;
useSession((session) => (s = session));

const settings = () => s.graph.locator('[role="dialog"][aria-label="Settings"]');

async function openSettings(tab: string): Promise<void> {
	if (!(await settings().isVisible())) await button(s, 'Settings').click();
	await settings().getByRole('tab', { name: tab }).click();
}

async function closeSettings(): Promise<void> {
	if (await settings().isVisible()) await button(settings(), 'Close settings').click();
	await expect(settings()).toHaveCount(0);
}

test('6.1 a remote is added and fetched from the Remotes tab', async () => {
	await openSettings('Remotes');
	await settings().getByLabel('Remote name').fill('mirror');
	await settings().getByLabel('Remote URL').fill(path.join(s.root, 'review-origin.git'));
	await button(settings(), 'Add & fetch').click();
	await eventually(() => s.git('remote'), /^mirror$/m);
	await eventually(() => s.git('branch', '-r'), /mirror\/develop/);
	await expect(button(settings(), 'Remove mirror')).toBeVisible();
});

test('6.2 a branch upstream is set and unset from its chip', async () => {
	await closeSettings();
	await menu(s, chip(s, 'develop'), 'Set Upstream of develop…');
	await dialog(s).locator('button.option', { hasText: 'mirror/develop' }).click();
	await eventually(
		() => s.git('for-each-ref', '--format=%(upstream:short)', 'refs/heads/develop'),
		/^mirror\/develop$/m
	);
	await menu(s, chip(s, 'develop'), 'Unset Upstream of develop');
	await eventually(
		() => s.git('for-each-ref', '--format=%(upstream:short)', 'refs/heads/develop'),
		/^\s*$/
	);
});

test('6.3 a remote is removed, its branches with it', async () => {
	await openSettings('Remotes');
	await button(settings(), 'Remove mirror').click();
	await confirm(s);
	await eventually(() => s.git('remote'), /^origin\s*$/);
	expect(s.git('branch', '-r')).not.toContain('mirror/');
});

test('6.4 the Worktrees tab lists every worktree and prunes the missing one', async () => {
	await openSettings('Worktrees');
	for (const text of ['main worktree', 'this window', 'wt/elsewhere', 'folder missing']) {
		await expect(settings().getByText(text, { exact: true }).first()).toBeVisible();
	}
	await button(settings(), 'Prune').click();
	await eventually(() => s.git('worktree', 'list'), /^(?![\s\S]*review-gone)/);
	await expect(settings().getByText('folder missing', { exact: true })).toHaveCount(0);
});

test('6.5 a branch held by another worktree opens that worktree instead of checking out', async () => {
	await closeSettings();
	// wt/elsewhere shares the merge commit with wt/gone, so it is folded behind a "+1".
	const elsewhere = await reachChip(s, 'wt/elsewhere', "Merge branch 'feature/merged'");
	await elsewhere.click({ button: 'right' });
	const listLabels = await s.graph.locator('ul.menu button').allInnerTexts();
	expect(listLabels.some((text) => text.includes('Checkout wt/elsewhere'))).toBe(false);
	const windowOpened = s.app.waitForEvent('window');
	await s.graph
		.locator('ul.menu button', { hasText: 'Open Worktree for wt/elsewhere in New Window' })
		.click();
	const other = await windowOpened;
	await expect.poll(() => other.title()).toContain('review-wt');
	await other.close();
});

test('6.6 a worktree is created from a chip, removed from the tab, and added from the form', async () => {
	await menu(s, chip(s, 'feature/picks'), 'Create Worktree for feature/picks…');
	const folder = dialog(s).locator('input');
	await expect(folder).toHaveValue(/review-feature-picks$/);
	await button(dialog(s), 'OK').click();
	await eventually(
		() => s.git('worktree', 'list'),
		/review-feature-picks\s+\w+ \[feature\/picks\]/
	);

	await openSettings('Worktrees');
	const created = (await s.git('worktree', 'list', '--porcelain'))
		.split('\n')
		.find((line) => line.startsWith('worktree ') && line.endsWith('review-feature-picks'))
		?.slice('worktree '.length);
	expect(created).toBeTruthy();
	await button(settings(), `Remove the worktree at ${created}`).click();
	await confirm(s);
	await eventually(() => s.git('worktree', 'list'), /^(?![\s\S]*review-feature-picks)/);
	expect(s.git('branch', '--list', 'feature/picks')).toContain('feature/picks');

	await settings().getByLabel('Worktree branch').fill('hotfix/new');
	await button(settings(), 'Add').click();
	await button(dialog(s, /^Create a worktree with a new branch/), 'OK').click();
	await eventually(() => s.git('worktree', 'list'), /review-hotfix-new\s+\w+ \[hotfix\/new\]/);
});
