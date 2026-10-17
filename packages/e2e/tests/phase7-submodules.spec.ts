import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, diff, file, row, section, toast } from '../src/ui.js';

// 110: a submodule in the review repository — its state in the working tree, its pointer in the diff,
// and its own graph one click away. Built for this session only; the shared fixture stays as it is.
let s: Session;
const ID = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];
useSession((session) => (s = session), {
	isolateGlobalConfig: true,
	prepare: (git, root) => {
		const engine = path.join(root, 'engine');
		git('init', '-q', '--initial-branch=main', engine);
		writeFileSync(path.join(engine, 'engine.ts'), 'export const v = 1;\n');
		git('-C', engine, 'add', 'engine.ts');
		git('-C', engine, ...ID, 'commit', '-qm', 'engine v1');
		git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', engine, 'libs/engine');
		git(...ID, 'commit', '-qm', 'chore: add the engine', '--', '.gitmodules', 'libs/engine');
		// A commit the superproject has not recorded yet: the pointer change the working tree shows.
		const checkout = path.join(git('rev-parse', '--show-toplevel').trim(), 'libs', 'engine');
		writeFileSync(path.join(checkout, 'engine.ts'), 'export const v = 2;\n');
		git('-C', checkout, ...ID, 'commit', '-qam', 'engine v2');
	},
});

const engineRow = () => file(section(s, 'Changes'), 'engine');

test('7.4 the working tree shows what moved inside the submodule', async () => {
	await row(s, 'Uncommitted Changes').click();
	await expect(engineRow()).toBeVisible();
	await expect(engineRow().getByText('new commits')).toBeVisible();
	await expect(engineRow().locator('.codicon-file-submodule')).toBeVisible();
});

test('7.5 Discard refuses a submodule instead of pretending', async () => {
	const pointer = s.git('-C', 'libs/engine', 'rev-parse', 'HEAD').trim();
	await engineRow().hover();
	await engineRow()
		.getByRole('button', { name: /^Discard changes to this file/ })
		.click();
	await expect(toast(s, 'is a submodule — discarding here cannot reset it')).toBeVisible();
	expect(s.git('-C', 'libs/engine', 'rev-parse', 'HEAD').trim()).toBe(pointer);
});

test('7.6 the diff shows the pointer move and opens the submodule’s own graph', async () => {
	await engineRow().locator('button.open').click();
	const card = diff(s).getByLabel('Submodule change');
	await expect(card).toContainText(/Submodule libs\/engine moves from \w{8} → \w{8}/);
	await button(card, 'Open submodule').click();
	await expect(row(s, 'engine v2')).toBeVisible();
	await expect(row(s, 'engine v1')).toBeVisible();
	await expect(row(s, 'add the engine')).toHaveCount(0);
	await expect(s.graph.locator('.dropdown .trigger').first()).toHaveText(/review › libs\/engine/);
});

test('7.7 the repo picker goes back to the superproject', async () => {
	await s.graph.locator('.dropdown .trigger').first().click();
	await s.graph.locator('.dropdown .menu button', { hasText: /^review$/ }).click();
	await expect(row(s, 'add the engine')).toBeVisible();
	await expect(row(s, 'engine v2')).toHaveCount(0);
});

test('7.8 Refresh picks up a submodule checked out after the graph opened', async () => {
	const picker = () => s.graph.locator('.dropdown .trigger').first();
	const pickerHas = async (label: RegExp) => {
		await picker().click();
		const found = await s.graph.locator('.dropdown .menu button', { hasText: label }).count();
		await s.page.keyboard.press('Escape');
		await s.graph
			.locator('.dropdown .backdrop')
			.click()
			.catch(() => undefined);
		return found;
	};
	s.git('submodule', 'deinit', '-q', '-f', 'libs/engine');
	await button(s, 'Refresh').click();
	// One repository left: the picker gives way to the plain repository name.
	await expect(s.graph.locator('.dropdown .trigger')).toHaveCount(0);
	s.git('-c', 'protocol.file.allow=always', 'submodule', 'update', '-q', '--init', 'libs/engine');
	await button(s, 'Refresh').click();
	await expect(picker()).toBeVisible();
	expect(await pickerHas(/review › libs\/engine/)).toBe(1);
});
