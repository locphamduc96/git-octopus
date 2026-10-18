import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useDesktopSession, type Session } from '../../src/session.js';
import { button, eventually, file, menu, row, section, toast } from '../../src/ui.js';

// 113d-6: what the desktop host does on its own — it watches the repository, asks git's questions in
// the window, shows an AI explanation in a panel, and follows the Desktop settings.
let s: Session;
useDesktopSession((session) => (s = session), { isolateGlobalConfig: true });

const settings = () => s.graph.locator('[role="dialog"][aria-label="Settings"]');

/** Click an item of the app menu bar, as the user would, by its top-level and item labels. */
async function appMenu(top: string, item: string): Promise<void> {
	await s.app.evaluate(
		({ Menu }, { top, item }) => {
			const menuTop = Menu.getApplicationMenu()?.items.find((entry) => entry.label === top);
			menuTop?.submenu?.items.find((entry) => entry.label === item)?.click();
		},
		{ top, item }
	);
}

async function openSettings(): Promise<void> {
	if (await settings().isVisible()) return;
	await appMenu('Git Octopus', 'Settings…');
	await expect(settings()).toBeVisible();
}

async function closeSettings(): Promise<void> {
	await button(settings(), 'Close settings').click();
	await expect(settings()).toHaveCount(0);
}

const themeSource = () => s.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
const userData = () => s.app.evaluate(({ app }) => app.getPath('userData'));

test('H.1 a file changed outside the app shows up in the changes without refreshing', async () => {
	await row(s, 'Uncommitted Changes').click();
	await expect(file(section(s, 'Changes'), 'board.ts')).toBeVisible();

	writeFileSync(path.join(s.repo, 'outside-edit.txt'), 'written by another program\n');
	await expect(file(section(s, 'Untracked'), 'outside-edit.txt')).toBeVisible();

	appendFileSync(path.join(s.repo, 'src/constants.ts'), '// edited in an editor\n');
	await expect(file(section(s, 'Changes'), 'constants.ts')).toBeVisible();
});

test('H.2 a commit made outside the app appears in the graph without refreshing', async () => {
	s.git('add', 'outside-edit.txt');
	s.git('commit', '-q', '-m', 'chore: committed from a terminal');
	await expect(row(s, 'chore: committed from a terminal')).toBeVisible();
	await expect(file(section(s, 'Untracked'), 'outside-edit.txt')).toHaveCount(0);
});

test('H.3 the explanation of an AI agent opens in a Markdown panel that copies, saves and closes', async () => {
	await button(s, 'Settings').click();
	await settings().getByRole('tab', { name: 'AI commit' }).click();
	const card = settings().getByRole('radio', { name: /Claude Code/ });
	await expect(card).toBeVisible();
	// If the app re-read the login shell's PATH, the real CLI would answer — and spend real tokens.
	const fake = (await card.innerText()).includes('0.0.0-git-octopus-e2e');
	if (!fake) await closeSettings();
	test.skip(!fake, 'the fake claude is not first on PATH; refusing to run a real agent');
	await card.click();
	await expect(card).toHaveAttribute('aria-checked', 'true');
	await closeSettings();

	await row(s, 'Uncommitted Changes').click();
	await button(s, 'Explain changes with AI').click();
	const panel = s.graph.getByRole('dialog', { name: 'uncommitted changes on main' });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText('Fake explanation from the e2e agent');

	await panel.getByRole('button', { name: 'Copy' }).click();
	await expect(toast(s, 'explanation copied')).toBeVisible();
	const copied = await s.app.evaluate(({ clipboard }) => clipboard.readText());
	expect(copied).toContain('Fake explanation from the e2e agent');
	expect(copied).toContain('# uncommitted changes on main');

	const saved = path.join(s.root, 'saved-explanation.md');
	await s.app.evaluate(({ dialog }, target) => {
		dialog.showSaveDialog = (() =>
			Promise.resolve({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
	}, saved);
	await panel.getByRole('button', { name: 'Save as…' }).click();
	await eventually(() => {
		try {
			return readFileSync(saved, 'utf8');
		} catch {
			return '';
		}
	}, /Fake explanation from the e2e agent/);
	await expect(toast(s, 'saved-explanation.md')).toBeVisible();

	await panel.getByRole('button', { name: 'Close' }).click();
	await expect(panel).toHaveCount(0);
});

test('H.4 Theme in Settings → General → Desktop changes the window at once and is remembered', async () => {
	const theme = () => s.page.evaluate(() => document.documentElement.dataset.theme);
	const remembered = async () => {
		const state = JSON.parse(readFileSync(path.join(await userData(), 'state.json'), 'utf8')) as {
			'gitOctopus.viewSettings'?: { settings?: { theme?: string } };
		};
		return state['gitOctopus.viewSettings']?.settings?.theme;
	};
	await openSettings();
	const picker = settings().getByLabel('Theme');
	await expect(picker).toHaveValue('system');

	await picker.selectOption('dark');
	await expect.poll(theme).toBe('dark');
	await expect(s.page.locator('body.vscode-dark')).toHaveCount(1);
	expect(await themeSource()).toBe('dark');
	await expect.poll(remembered).toBe('dark');

	await picker.selectOption('light');
	await expect.poll(theme).toBe('light');
	await expect(s.page.locator('body.vscode-light')).toHaveCount(1);
	expect(await themeSource()).toBe('light');

	await picker.selectOption('system');
	await expect.poll(themeSource).toBe('system');
	await expect.poll(remembered).toBe('system');
	await closeSettings();
});

test('H.5 an editor command from Settings opens a working-tree file', async () => {
	const marker = path.join(s.root, 'opened-file.txt');
	await openSettings();
	await settings().getByLabel('External editor').selectOption('custom');
	const command = settings().getByLabel('Editor command');
	await command.fill(`/bin/sh -c "printf %s '{file}' > ${marker}"`);
	await command.press('Tab');
	await closeSettings();

	await row(s, 'Uncommitted Changes').click();
	await menu(s, file(section(s, 'Changes'), 'board.ts'), 'Open File');
	await eventually(
		() => {
			try {
				return readFileSync(marker, 'utf8');
			} catch {
				return '';
			}
		},
		new RegExp(`^${path.join(s.repo, 'src/board.ts').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
	);
});

test('H.6 a Git path that is not there is named in the view, and emptying it brings git back', async () => {
	const missing = path.join(s.root, 'no-git-here', 'git');
	await openSettings();
	const input = settings().getByLabel('Git path');
	await input.fill(missing);
	await input.press('Tab');
	await expect(toast(s, `cannot run git at ${missing}`)).toBeVisible();
	await expect(s.graph.locator('p.error')).toContainText(missing);

	await input.fill('');
	await input.press('Tab');
	await closeSettings();
	await expect(row(s, 'chore: committed from a terminal')).toBeVisible();
});

/** A smart-HTTP stand-in that asks for credentials and records the ones it is given. */
function credentialServer(): { server: Server; listAuth: string[] } {
	const listAuth: string[] = [];
	const server = createServer((request, response) => {
		const header = request.headers.authorization;
		if (!header) {
			response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' }).end();
			return;
		}
		listAuth.push(header);
		response.writeHead(404).end();
	});
	return { server, listAuth };
}

test('H.7 git asks for a password in a dialog of the window, and gets what is typed', async () => {
	const { server, listAuth } = credentialServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const { port } = server.address() as AddressInfo;
		// No credential helper (the system gitconfig may name the Keychain): nothing is saved.
		s.git('config', 'credential.helper', '');
		s.git('remote', 'add', 'secure', `http://127.0.0.1:${port}/repo.git`);
		const ask = s.graph.getByRole('dialog', { name: /fetch — review → 127\.0\.0\.1/ });

		await appMenu('Repository', 'Fetch');
		await expect(ask).toBeVisible();
		await expect(ask).toContainText('Username for');
		await ask.getByLabel('Username').fill('octo');
		await ask.getByLabel('Username').press('Enter');

		await expect(ask).toContainText('Password for');
		const password = ask.getByLabel('Password');
		expect(await password.getAttribute('type')).toBe('password');
		await password.fill('hunter2');
		await password.press('Enter');

		await expect.poll(() => listAuth.length, { timeout: 20_000 }).toBeGreaterThan(0);
		expect(Buffer.from(listAuth[0].replace('Basic ', ''), 'base64').toString()).toBe(
			'octo:hunter2'
		);
		await expect(ask).toHaveCount(0);

		// Cancelling is an answer too: the fetch stops, and nothing further is sent.
		const before = listAuth.length;
		await appMenu('Repository', 'Fetch');
		await expect(ask).toBeVisible();
		await ask.getByRole('button', { name: 'Cancel' }).click();
		await expect(ask).toHaveCount(0);
		await expect(toast(s, /fetch/i).first()).toBeVisible();
		expect(listAuth.length).toBe(before);

		// The password reached neither the host log nor a notice.
		const log = readFileSync(path.join(await userData(), 'logs', 'host.log'), 'utf8');
		expect(log).not.toContain('hunter2');
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
