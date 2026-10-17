import { defineConfig } from '@playwright/test';

// One VS Code window at a time: each spec file opens its own and drives it in order, the way the
// smoke checklist runs phase by phase.
export default defineConfig({
	timeout: 120_000,
	// The extension inside the pinned VS Code, and the desktop app: one suite each, the same helpers.
	projects: [
		{ name: 'vscode', testDir: './tests', testIgnore: ['desktop/**'] },
		{ name: 'desktop', testDir: './tests/desktop' },
	],
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	globalSetup: './src/globalSetup.ts',
});
