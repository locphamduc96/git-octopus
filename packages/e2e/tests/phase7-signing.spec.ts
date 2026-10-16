import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, dialog, eventually, row } from '../src/ui.js';

// 109: commit signing set up from the Signing tab, a commit made from the commit box, and the badge.
// The key is made for the session and lives in its folder; git sees an empty global config, so the
// result is the extension's, not whatever the machine's ~/.gitconfig says.
let s: Session;
let key = '';
let signers = '';
useSession((session) => (s = session), {
	isolateGlobalConfig: true,
	prepare: (_git, root) => {
		key = path.join(root, 'id_signing');
		execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', key]);
		signers = path.join(root, 'allowed_signers');
		writeFileSync(signers, `test@example.invalid ${readFileSync(`${key}.pub`, 'utf8')}`);
	},
});

const settings = () => s.graph.locator('[role="dialog"][aria-label="Settings"]');
const commitDialog = () => dialog(s, /^Commit \d+ staged file/);
const local = (name: string): string => {
	try {
		return s.git('config', '--local', '--get', name).trim();
	} catch {
		return '';
	}
};

test('7.1 the Signing tab writes signing to the repository config only', async () => {
	await button(s, 'Settings').click();
	await settings().getByRole('tab', { name: 'Signing' }).click();
	await settings().getByLabel('Show signatures on the graph').check();
	await settings().getByLabel('Signing format').selectOption('ssh');
	await eventually(() => local('gpg.format'), 'ssh');
	// SSH with nothing to check against: the tab says why badges would not appear.
	await expect(settings().getByText(/allowed signers file git cannot check/)).toBeVisible();

	await settings().getByLabel('Signing key').fill(`${key}.pub`);
	await button(settings(), 'Save').click();
	await eventually(() => local('user.signingkey'), `${key}.pub`);
	await settings().getByLabel('Allowed signers file').fill(signers);
	await settings().getByLabel('Allowed signers file').press('Enter');
	await eventually(() => local('gpg.ssh.allowedsignersfile'), signers);
	await settings().getByLabel('Sign commits in this repository').check();
	await eventually(() => local('commit.gpgsign'), 'true');

	await expect(settings().getByRole('alert')).toHaveCount(0);
	expect(readFileSync(path.join(s.root, 'global.gitconfig'), 'utf8')).toBe('');
	await button(settings(), 'Close settings').click();
});

test('7.2 a commit from the commit box is signed, and the graph says so', async () => {
	await row(s, 'Uncommitted Changes').click();
	await button(s, 'Stage all').click();
	await eventually(() => s.git('diff', '--cached', '--name-only'), /src\/board\.ts/);
	await button(s, 'Commit').click();
	await commitDialog()
		.getByPlaceholder('Short description of the change')
		.fill('feat: signed from the commit box');
	await button(commitDialog(), 'Commit').click();
	await eventually(
		() => s.git('log', '-1', '--format=%s %G?'),
		'feat: signed from the commit box G'
	);

	const signed = row(s, 'feat: signed from the commit box');
	await expect(signed.getByRole('img', { name: 'Good signature' })).toBeVisible();
	// The fixture's own history is unsigned: no badge anywhere else.
	await expect(s.graph.locator('.signature')).toHaveCount(1);
});

test('7.3 the details name the signer and the key', async () => {
	await row(s, 'feat: signed from the commit box').click();
	const subjectBar = s.graph.locator('button.subject-bar');
	// Folded, the byline carries the shield alone; unfolded, the block says who signed.
	await expect(subjectBar.locator('.signature.good')).toBeVisible();
	if ((await subjectBar.getAttribute('aria-expanded')) !== 'true') await subjectBar.click();
	await expect(s.graph.getByText('Good signature — test@example.invalid')).toBeVisible();
	await expect(s.graph.locator('dd.signature .key')).toHaveText(/^SHA256:/);
});
