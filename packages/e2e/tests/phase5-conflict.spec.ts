import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, chip, dialog, dragChip, eventually, file, menu, section } from '../src/ui.js';

// Phase 5 of the smoke checklist: a merge that conflicts in README.md line 3.
let s: Session;
useSession((session) => (s = session), {
	prepare: (git) => {
		git('checkout', '--', '.');
		git('clean', '-fdq');
	},
});

const readme = () => readFileSync(path.join(s.repo, 'README.md'), 'utf8');
const conflicted = () => file(section(s, 'Conflicts'), 'README.md');

test('5.1 a dragged merge stops on the conflict and lists the file', async () => {
	await dragChip(chip(s, 'conflict/incoming'), chip(s, 'main'));
	await s.graph
		.locator('ul.menu button', { hasText: 'Merge conflict/incoming into main…' })
		.click();
	await expect(dialog(s)).toContainText('choose options');
	await button(dialog(s), 'OK').click();
	await eventually(() => s.git('status', '--porcelain'), /^UU README\.md/m);
	await expect(conflicted()).toBeVisible();
	await expect(button(s, 'Continue')).toBeVisible();
});

test('5.2 the Conflicts menu offers every way out, and opens the merge editor', async () => {
	await conflicted().click({ button: 'right' });
	const listLabels = await s.graph.locator('ul.menu button').allInnerTexts();
	for (const label of [
		'Open in Merge Editor',
		'Take Current',
		'Take Incoming',
		'Restore Conflict Markers',
		'Mark Resolved',
	]) {
		expect(listLabels.some((text) => text.includes(label))).toBe(true);
	}
	await s.graph.locator('ul.menu button', { hasText: 'Open in Merge Editor' }).click();
	const mergeTab = s.page.locator('.tabs-container .tab', { hasText: 'README.md' });
	await expect(mergeTab).toBeVisible();
	await expect(s.page.locator('.merge-editor-view, .merge-editor').first()).toBeVisible();
	// The graph stays open beside it.
	await expect(s.page.locator('.tabs-container .tab', { hasText: 'Git Octopus' })).toBeVisible();
	await test
		.info()
		.attach('merge-editor.png', { body: await s.page.screenshot(), contentType: 'image/png' });
	// Closing the merge editor is VS Code's business (it asks about the unresolved conflict); the
	// graph is brought back to front instead.
	await s.page.locator('.tabs-container .tab', { hasText: 'Git Octopus' }).click();
	await expect(conflicted()).toBeVisible();
});

test('5.3 conflict markers come back after a hand edit', async () => {
	writeFileSync(path.join(s.repo, 'README.md'), '# Rhythm review\n\nTitle line edited by hand.\n');
	await menu(s, conflicted(), 'Restore Conflict Markers');
	await eventually(readme, /<<<<<<< /);
});

test('5.4 taking the incoming side resolves the file, and Continue makes the merge', async () => {
	await menu(s, conflicted(), 'Take Incoming');
	await eventually(readme, /Title line from the incoming branch\./);
	await eventually(() => s.git('status', '--porcelain'), /^M {2}README\.md/m);
	await button(s, 'Continue').click();
	await eventually(() => s.git('rev-list', '--parents', '-n', '1', 'HEAD'), /^\w+ \w+ \w+$/m);
});
