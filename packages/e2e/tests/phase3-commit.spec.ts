import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, dialog, eventually, row, toast } from '../src/ui.js';

// Phase 3 of the smoke checklist: the commit box. The fixture sets commit.template and a commit-msg
// hook that refuses any message containing "chan-hook".
let s: Session;
useSession((session) => (s = session));

const commitDialog = () => dialog(s, /^Commit \d+ staged file/);
const summary = () => commitDialog().getByPlaceholder('Short description of the change');

async function openCommitDialog(): Promise<void> {
	await button(s, 'Commit').click();
	await expect(commitDialog()).toBeVisible();
}

test('3.1 the commit dialog starts from commit.template', async () => {
	await row(s, 'Uncommitted Changes').click();
	await button(s, 'Stage all').click();
	await eventually(() => s.git('diff', '--cached', '--name-only'), /src\/board\.ts/);
	await openCommitDialog();
	await expect(summary()).toHaveValue(/^feat:/);
});

test('3.2 a hook refuses the commit', async () => {
	await summary().fill('test chan-hook');
	await button(commitDialog(), 'Commit').click();
	await expect(toast(s, 'commit-msg hook cua playground: chan')).toBeVisible();
	expect(s.git('log', '-1', '--format=%s')).not.toContain('chan-hook');
});

test('3.2b the dialog comes back by itself with the refused message', async () => {
	await expect(commitDialog()).toBeVisible();
	await expect(summary()).toHaveValue('test chan-hook');
});

test('3.2c Skip Git hooks gets past the hook', async () => {
	await summary().fill('test chan-hook');
	await commitDialog()
		.getByLabel(/Skip Git hooks/)
		.check();
	await commitDialog()
		.getByLabel(/Push after committing/)
		.check();
	await button(commitDialog(), 'Commit').click();
	await eventually(() => s.git('log', '-1', '--format=%s'), /^test chan-hook$/m);
});

test('3.3 push after committing sends the new commit to the remote', async () => {
	const tip = s.git('rev-parse', 'HEAD').trim();
	await eventually(() => s.git('ls-remote', 'origin', 'refs/heads/main'), new RegExp(`^${tip}`));
});
