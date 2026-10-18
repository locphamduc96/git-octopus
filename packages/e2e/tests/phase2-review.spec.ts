import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import {
	answer,
	closeDiff,
	dialog,
	diff,
	eventually,
	file,
	menu,
	row,
	section,
	selectedRow,
} from '../src/ui.js';

// Phase 2 of the smoke checklist: reviewing the uncommitted work the fixture leaves behind — two
// hunks in src/board.ts, a re-indent in src/format.ts, an untracked notes/todo.md.
let s: Session;
useSession((session) => (s = session));

async function openWorking(section_: 'Changes' | 'Staged Changes', name: string): Promise<void> {
	await closeDiff(s);
	await row(s, 'Uncommitted Changes').click();
	await file(section(s, section_), name).locator('button.open').click();
	await expect(diff(s).locator('.row.add, .row.pair').first()).toBeVisible();
}

test('2.1 the diff marks changed words, goes side by side, wraps, and ignores whitespace', async () => {
	await openWorking('Changes', 'board.ts');
	const view = diff(s);
	// 104: inside the edited line, only the words that changed are marked.
	// Syntax colours may cut a marked run into several spans, so the run is read joined.
	const marked = (text: string) =>
		view.locator('.row.add', { hasText: text }).locator('.emph').allTextContents();
	await expect.poll(async () => (await marked('best: 0')).join('')).toBe(', best: 0');
	await expect
		.poll(async () => (await marked('lorem ipsum')).join(''))
		.toContain('deliberately long');
	await test
		.info()
		.attach('intraline.png', { body: await s.page.screenshot(), contentType: 'image/png' });
	await view.getByRole('button', { name: 'Side by side' }).click();
	await expect(view.locator('.row.pair:has(.half.del):has(.half.add)').first()).toBeVisible();
	await view.getByRole('button', { name: 'Side by side' }).click();
	await expect(view.locator('.row.pair')).toHaveCount(0);

	const longLine = view.locator('.row.add', { hasText: 'lorem ipsum' });
	const before = (await longLine.boundingBox())?.height ?? 0;
	await view.getByRole('button', { name: 'Wrap long lines' }).click();
	await expect
		.poll(async () => (await longLine.boundingBox())?.height ?? 0)
		.toBeGreaterThan(before * 1.5);
	await view.getByRole('button', { name: 'Wrap long lines' }).click();

	await openWorking('Changes', 'format.ts');
	await expect(view.locator('.row.add')).toHaveCount(1);
	await view.getByRole('button', { name: 'Ignore whitespace' }).click();
	await expect(view.locator('.row.add')).toHaveCount(0);
	await view.getByRole('button', { name: 'Ignore whitespace' }).click();
	await expect(view.locator('.row.add')).toHaveCount(1);
});

test('2.1b line numbers fill their row, so code scrolled sideways never shows through them', async () => {
	await closeDiff(s);
	await row(s, 'feat: scoreboard').click();
	await file(s.graph.locator('body'), 'constants.ts').locator('button.open').click();
	const view = diff(s);
	await expect(view.locator('.row.add').first()).toBeVisible();
	// An added line has no old number: that empty cell is the one that used to collapse to 0px.
	const listGaps = await view
		.locator('.row:not(.pair)')
		.evaluateAll((listRows) =>
			listRows.flatMap((line) =>
				[...line.querySelectorAll('.gutter')].map(
					(gutter) => line.getBoundingClientRect().height - gutter.getBoundingClientRect().height
				)
			)
		);
	expect(listGaps.length).toBeGreaterThan(0);
	expect(listGaps.filter((gap) => gap !== 0)).toEqual([]);
});

test('2.2 lines and hunks are staged, unstaged and discarded on their own', async () => {
	await openWorking('Changes', 'board.ts');
	const view = diff(s);
	await view
		.locator('.row.del', { hasText: 'combo = { value: 0 };' })
		.locator('button.gutter')
		.first()
		.click();
	await view
		.locator('.row.add', { hasText: 'best: 0' })
		.locator('button.gutter')
		.first()
		.click({ modifiers: ['Shift'] });
	await view.getByRole('button', { name: 'Stage 2 lines' }).click();
	await eventually(
		() => s.git('diff', '--cached'),
		/\+export const combo = \{ value: 0, best: 0 \};/
	);
	expect(s.git('diff', '--cached')).not.toContain('lorem ipsum');
	expect(s.git('diff')).toContain('lorem ipsum');
	await expect(file(section(s, 'Staged Changes'), 'board.ts')).toBeVisible();
	await expect(file(section(s, 'Changes'), 'board.ts')).toBeVisible();

	await openWorking('Staged Changes', 'board.ts');
	await view.getByRole('button', { name: 'Unstage hunk' }).click();
	await eventually(() => s.git('diff', '--cached', '--name-only'), /^$/);

	await openWorking('Changes', 'board.ts');
	await view.locator('.row.gap').nth(1).getByRole('button', { name: 'Discard hunk' }).click();
	await expect(dialog(s)).toContainText('Discard');
	await answer(s, 'Discard');
	await eventually(() => s.git('diff', '--', 'src/board.ts'), /best: 0/);
	expect(readFileSync(path.join(s.repo, 'src/board.ts'), 'utf8')).not.toContain('lorem ipsum');
});

test('2.2b lines are picked side by side as well', async () => {
	await openWorking('Changes', 'board.ts');
	const view = diff(s);
	await view.getByRole('button', { name: 'Side by side' }).click();
	await view
		.locator('.half.del', { hasText: 'combo = { value: 0 };' })
		.locator('button.gutter')
		.click();
	await view.locator('.half.add', { hasText: 'best: 0' }).locator('button.gutter').click();
	await view.getByRole('button', { name: 'Stage 2 lines' }).click();
	await eventually(
		() => s.git('diff', '--cached'),
		/\+export const combo = \{ value: 0, best: 0 \};/
	);
	expect(s.git('diff', '--cached')).toContain('-export const combo = { value: 0 };');
	await view.getByRole('button', { name: 'Side by side' }).click();
	s.git('restore', '--staged', '--', 'src/board.ts');
});

test('2.3 a commit compares with the working tree, from the menu or by Ctrl/Cmd+click', async () => {
	await closeDiff(s);
	await menu(s, row(s, 'tune: faster notes'), 'Compare with Working Tree');
	await expect(s.graph.getByText(/↔ working tree/).first()).toBeVisible();
	const files = s.graph.locator('.file-row').filter({ visible: true });
	await expect(files.filter({ hasText: 'levels.jsonl' })).toHaveCount(1);
	await expect(files.filter({ hasText: 'board.ts' })).toHaveCount(1);

	await row(s, 'Uncommitted Changes').click();
	await row(s, 'feat: scoreboard').click({ modifiers: ['ControlOrMeta'] });
	await expect(s.graph.getByText(/↔ working tree/).first()).toBeVisible();
	await expect(files.filter({ hasText: 'constants.ts' })).toHaveCount(1);
});

test('2.4 a file is restored as it was in a commit', async () => {
	await closeDiff(s);
	await row(s, 'feat: scoreboard').click();
	await menu(s, file(s.graph.locator('body'), 'constants.ts'), 'Restore File from this Commit…');
	await answer(s, 'Restore');
	await eventually(() => readFileSync(path.join(s.repo, 'src/constants.ts'), 'utf8'), /SPEED = 1;/);
	expect(s.git('diff', '--cached', '--name-only')).toContain('src/constants.ts');
	s.git('restore', '--staged', '--worktree', '--source=HEAD', '--', 'src/constants.ts');
});

test('2.5 file history follows a rename, and blame leads to the commit', async () => {
	await closeDiff(s);
	await row(s, 'fix: reset combo on miss').click();
	await menu(s, file(s.graph.locator('body'), 'board.ts'), 'File History');
	const entries = s.graph
		.locator('li', { has: s.graph.locator('.subject') })
		.filter({ visible: true });
	await expect(entries).toHaveCount(4);
	await expect(entries.filter({ hasText: 'as scoreboard.ts' }).first()).toBeVisible();

	await entries.first().click();
	await expect(diff(s)).toBeVisible();
	await s.page.keyboard.press('ArrowDown');
	await expect(s.graph.locator('li.active:has(.subject)')).toContainText(
		'rename scoreboard to board'
	);

	await diff(s).getByRole('button', { name: 'Blame' }).click();
	const annotation = diff(s).locator('button.blame').first();
	await expect(annotation).toBeVisible();
	await annotation.click();
	await expect(selectedRow(s)).toContainText('scoreboard');
});

test('2.6 one file is stashed and the rest stays', async () => {
	await closeDiff(s);
	await row(s, 'Uncommitted Changes').click();
	await menu(s, file(section(s, 'Untracked'), 'todo.md'), 'Stash This File…');
	await dialog(s).locator('input').fill('todo');
	await answer(s, 'OK');
	await eventually(() => s.git('stash', 'list'), /todo/);
	expect(s.git('status', '--porcelain')).not.toContain('notes/');
	expect(s.git('status', '--porcelain')).toContain('src/board.ts');
});

test('2.6b one file comes back out of the stash, untracked as it was', async () => {
	await closeDiff(s);
	await row(s, 'On main: todo').click();
	await menu(s, file(s.graph.locator('body'), 'todo.md'), 'Apply This File from Stash');
	await eventually(() => s.git('status', '--porcelain'), /^\?\? notes\/$/m);
	expect(s.git('stash', 'list')).toContain('todo');
});

test('2.7 an image shows its old and new pixels instead of "binary file"', async () => {
	await closeDiff(s);
	await row(s, 'art: recolour the logo').click();
	await file(s.graph.locator('body'), 'logo.png').locator('button.open').click();
	await expect(s.graph.getByAltText('Before')).toBeVisible();
	await expect(s.graph.getByAltText('After')).toBeVisible();
	await expect(s.graph.locator('.images .meta').first()).toContainText('1 × 1 px');
	await test
		.info()
		.attach('image-diff.png', { body: await s.page.screenshot(), contentType: 'image/png' });
	await s.graph.getByRole('radio', { name: 'Overlay' }).click();
	await expect(s.graph.getByLabel('Show the new image over the old')).toBeVisible();
});

test('2.8 a file LFS stores is marked, and its diff names the objects, not the pointer text', async () => {
	await closeDiff(s);
	await row(s, 'art: new mix').click();
	const music = file(s.graph.locator('body'), 'music.bin');
	await expect(music.locator('.lfs')).toHaveText('LFS');
	await music.locator('button.open').click();
	const card = s.graph.getByRole('region', { name: 'Git LFS object' });
	await expect(card).toContainText('1.0 MB');
	await expect(card).toContainText('2.5 MB');
	await expect(card).toContainText('oid bbbbbbbbbbbb');
});
