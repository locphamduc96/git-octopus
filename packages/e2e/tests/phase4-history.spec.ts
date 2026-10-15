import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, chip, confirm, dialog, dragChip, eventually, head, menu, row } from '../src/ui.js';

// Phase 4 of the smoke checklist: rewriting history. Rebases need a clean tree, so the fixture's
// uncommitted work is dropped before VS Code opens.
let s: Session;
useSession((session) => (s = session), {
	prepare: (git) => {
		git('checkout', '--', '.');
		git('clean', '-fdq');
	},
});

const subjects = (range: string): string[] =>
	s
		.git('log', '--format=%s', range)
		.trim()
		.split('\n')
		.filter((line) => line !== '');

const editorRow = (subject: string) => dialog(s).locator('ol.rows > li', { hasText: subject });

test('4.1 interactive rebase folds, drops and rewords in one run', async () => {
	await chip(s, 'feature/tidy').dblclick();
	await eventually(() => head(s), 'feature/tidy');
	await menu(s, row(s, 'chore: import level data'), 'Interactive Rebase from Here…');
	await expect(dialog(s, 'Interactive rebase').locator('ol.rows > li')).toHaveCount(4);
	await editorRow('fixup typo').press('f');
	await editorRow('wip').press('d');
	await editorRow('feat: tidy the menu').press('r');
	await dialog(s)
		.getByLabel('New message for feat: tidy the menu')
		.fill('feat: tidy the menu and the pause screen');
	await button(dialog(s), 'Start rebase').click();
	await expect
		.poll(() => subjects('main..feature/tidy'))
		.toEqual(['feat: tidy the menu and the pause screen', 'feat: tidy the hud']);
	expect(s.git('ls-tree', '-r', '--name-only', 'feature/tidy')).not.toContain('wip.txt');
	expect(s.git('show', 'feature/tidy:tidy.txt')).toContain('oops');
});

test('4.2 undo puts the branch back, and redo replays the rewrite', async () => {
	await button(s, 'Undo').click();
	if (await dialog(s).isVisible()) await confirm(s);
	await expect.poll(() => subjects('main..feature/tidy')).toHaveLength(4);
	await button(s, 'Redo').click();
	if (await dialog(s).isVisible()) await confirm(s);
	await expect.poll(() => subjects('main..feature/tidy')).toHaveLength(2);
});

test('4.3 a branch dragged onto another is rebased there through the editor', async () => {
	await dragChip(chip(s, 'feature/rebase-me'), chip(s, 'main'));
	await s.graph
		.locator('ul.menu button', { hasText: 'Interactive Rebase feature/rebase-me onto main…' })
		.click();
	const editor = dialog(s, 'Interactive rebase feature/rebase-me onto main');
	await expect(editor.locator('ol.rows > li')).toHaveCount(3);
	await editorRow('rebase-me: step 3').press('Alt+ArrowUp');
	await editorRow('rebase-me: step 3').press('Alt+ArrowUp');
	await button(editor, 'Start rebase').click();
	await eventually(() => head(s), 'feature/rebase-me');
	await expect
		.poll(() => subjects('main..feature/rebase-me'))
		.toEqual(['rebase-me: step 2', 'rebase-me: step 1', 'rebase-me: step 3']);
	expect(s.git('merge-base', 'main', 'feature/rebase-me').trim()).toBe(
		s.git('rev-parse', 'main').trim()
	);
});

test('4.4 the cherry-pick editor applies the kept commits in its order, with -x', async () => {
	await chip(s, 'main').dblclick();
	await eventually(() => head(s), 'main');
	// Only feature/picks on show, so a shift-click range holds its commits and nothing between.
	await menu(s, chip(s, 'feature/picks'), 'Show Only feature/picks');
	await row(s, 'feat: pick one').click();
	await row(s, 'feat: pick three').click({ modifiers: ['Shift'] });
	await menu(s, row(s, 'feat: pick two'), 'Cherry Pick 3 Commits…');
	const editor = dialog(s, 'Cherry pick commits');
	await expect(editor.locator('ol.rows > li .subject')).toHaveText([
		'feat: pick one',
		'feat: pick two',
		'feat: pick three',
	]);
	await editorRow('feat: pick two').press('Space');
	await editor.getByLabel(/Record where each commit came from/).check();
	await button(editor, 'Cherry pick 2 commits').click();
	await expect.poll(() => subjects('-2')).toEqual(['feat: pick three', 'feat: pick one']);
	expect(s.git('log', '-1', '--format=%B')).toContain('(cherry picked from commit');
});

test('4.5 the cherry-pick editor can stage the changes without committing', async () => {
	const before = s.git('rev-parse', 'HEAD').trim();
	await row(s, 'feat: pick two').click();
	await row(s, 'feat: pick four').click({ modifiers: ['Shift'] });
	await menu(s, row(s, 'feat: pick three'), 'Cherry Pick 3 Commits…');
	const editor = dialog(s, 'Cherry pick commits');
	await editor.getByLabel('Pick feat: pick three').uncheck();
	await editor.getByLabel(/Stage the changes without committing/).check();
	await button(editor, 'Apply 2 commits').click();
	await eventually(() => s.git('diff', '--cached', '--name-only'), /pick-four\.txt/);
	expect(s.git('diff', '--cached', '--name-only')).toContain('pick-two.txt');
	expect(s.git('rev-parse', 'HEAD').trim()).toBe(before);
	s.git('commit', '-qm', 'chore: picks');
	await s.graph.locator('.filter-pill').click();
});

test('4.6 dragging pushes to a remote-only branch, and resets a branch to another', async () => {
	await dragChip(chip(s, 'feature/push-me'), chip(s, 'release'));
	const listItems = s.graph.locator('ul.menu button');
	await expect(
		listItems.filter({ hasText: /^Rebase feature\/push-me onto origin\/release…/ })
	).toHaveCount(1);
	await expect(
		listItems.filter({ hasText: 'Interactive Rebase feature/push-me onto origin/release…' })
	).toHaveCount(1);
	await listItems.filter({ hasText: 'Push feature/push-me to origin/release…' }).click();
	await expect(dialog(s)).toContainText('Push feature/push-me to origin/release?');
	await confirm(s);
	const pushMe = s.git('rev-parse', 'feature/push-me').trim();
	await eventually(
		() => s.git('ls-remote', 'origin', 'refs/heads/release'),
		new RegExp(`^${pushMe}`)
	);

	await dragChip(chip(s, 'develop'), chip(s, 'feature/merged'));
	await s.graph.locator('ul.menu button', { hasText: 'Reset feature/merged to develop…' }).click();
	await confirm(s);
	await eventually(
		() => s.git('rev-parse', 'feature/merged'),
		s.git('rev-parse', 'develop').trim()
	);
});
