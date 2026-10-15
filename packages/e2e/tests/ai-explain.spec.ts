import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { button, chip, menu, row } from '../src/ui.js';

// Checklist 2.7: AI Explain, against the fake `claude` in fixtures/bin — never a real agent.
let s: Session;
useSession((session) => (s = session));

const settings = () => s.graph.locator('[role="dialog"][aria-label="Settings"]');
/** The text of the editor that has focus — where the explanation opens. */
const activeEditor = () => s.page.locator('.editor-group-container.active .view-lines');
const prompt = () => readFileSync(s.agentLog, 'utf8');

let fakeAgent = false;
test.beforeEach(({}, testInfo) => {
	if (testInfo.title.startsWith('2.7a')) return;
	test.skip(!fakeAgent, 'the fake agent CLI was not picked');
});

async function backToGraph(): Promise<void> {
	await s.page.locator('.tabs-container .tab', { hasText: 'Git Octopus' }).click();
}

test('2.7a the fake agent is picked, and only the fake one', async () => {
	await button(s, 'Settings').click();
	await settings().getByRole('tab', { name: 'AI commit' }).click();
	const card = settings().getByRole('radio', { name: /Claude Code/ });
	await expect(card).toBeVisible();
	// If VS Code re-read the login shell's PATH, the real CLI would answer — and spend real tokens.
	const fake = (await card.innerText()).includes('0.0.0-git-octopus-e2e');
	if (!fake) await button(settings(), 'Close settings').click();
	test.skip(!fake, 'the fake claude is not first on PATH; refusing to run a real agent');
	await card.click();
	await expect(card).toHaveAttribute('aria-checked', 'true');
	await button(settings(), 'Close settings').click();
	fakeAgent = true;
});

test('2.7b the uncommitted changes are explained in a Markdown document', async () => {
	await row(s, 'Uncommitted Changes').click();
	await button(s, 'Explain changes with AI').click();
	await expect(activeEditor()).toContainText('Fake explanation from the e2e agent');
	await expect(activeEditor()).toContainText('uncommitted changes on main');
	expect(prompt()).toContain('src/board.ts');
	expect(prompt()).toContain('best: 0');
	// notes/todo.md is untracked: its content rides along as an all-added diff.
	expect(prompt()).toContain('try a 7-lane chart');
});

test('2.7c a merge commit is explained by what it brought in', async () => {
	await backToGraph();
	await menu(s, row(s, "Merge branch 'feature/merged'"), 'Explain Commit with AI');
	await expect(activeEditor()).toContainText("Merge branch 'feature/merged'");
	expect(prompt()).toContain('merged/a.txt');
	expect(prompt()).not.toContain('levels.jsonl');
});

test('2.7d a branch is explained against the checked-out one', async () => {
	await backToGraph();
	await menu(s, chip(s, 'develop'), 'Explain develop with AI');
	await expect(activeEditor()).toContainText('branch develop — 2 commits not on main');
	expect(prompt()).toContain('perf: cache the lane layout');
});
