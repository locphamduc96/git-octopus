import { defineConfig } from '@playwright/test';

// Measuring runs (feature-113a), kept out of `pnpm e2e`: slow, and they need a cloned large repo.
export default defineConfig({
	testDir: './perf',
	testMatch: '*.perf.ts',
	timeout: 600_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	globalSetup: './src/globalSetup.ts',
});
