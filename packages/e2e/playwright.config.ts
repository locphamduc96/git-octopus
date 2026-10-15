import { defineConfig } from '@playwright/test';

// One VS Code window at a time: each spec file opens its own and drives it in order, the way the
// smoke checklist runs phase by phase.
export default defineConfig({
	testDir: './tests',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	globalSetup: './src/globalSetup.ts',
});
