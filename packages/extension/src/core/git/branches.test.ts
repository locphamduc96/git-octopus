import { describe, expect, it } from 'vitest';
import type { GitExecutor } from './GitExecutor';
import { getBranchEntries } from './gitService';

const SHA = 'f'.repeat(40);

function executorReturning(output: string): GitExecutor {
	return { run: () => Promise.resolve(output) };
}

describe('getBranchEntries', () => {
	it('drops the remote HEAD symbolic ref, which shortens to a bare remote name', () => {
		// `origin/HEAD` prints its short name as just "origin"; treating it as a branch would leave
		// an empty label once the "origin/" prefix is stripped for display.
		const output = [
			`origin\0${SHA}\0\0refs/remotes/origin/main`,
			`origin/main\0${SHA}\0\0`,
			`origin/feat/x\0${SHA}\0\0`,
		].join('\n');
		const listEntries = getBranchEntries(executorReturning(output), '/repo', 'refs/remotes/origin');
		return listEntries.then((list) => {
			expect(list.map((entry) => entry.name)).toEqual(['origin/main', 'origin/feat/x']);
		});
	});

	it('marks the checked-out branch', async () => {
		const output = [`main\0${SHA}\0*\0`, `dev\0${SHA}\0\0`].join('\n');
		const list = await getBranchEntries(executorReturning(output), '/repo', 'refs/heads');
		expect(list.find((entry) => entry.name === 'main')?.current).toBe(true);
		expect(list.find((entry) => entry.name === 'dev')?.current).toBe(false);
	});
});
