import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { getFileDiff } from './gitService';

/** The executor and diff pipeline against a real repository, not a scripted fake. */
describe('git integration', () => {
	let repo: TempRepo;
	const executor = new GitProcessExecutor();

	beforeAll(async () => {
		repo = await createTempRepo();
	});

	afterAll(async () => {
		await repo.dispose();
	});

	it('runs git and resolves stdout', async () => {
		await repo.commit('a.txt', 'hello\n', 'first');
		const output = await executor.run(['rev-parse', '--is-inside-work-tree'], repo.cwd);
		expect(output.trim()).toBe('true');
	});

	it('rejects with stderr when git fails', async () => {
		await expect(executor.run(['rev-parse', '--verify', 'no-such-ref'], repo.cwd)).rejects.toThrow(
			/no-such-ref|Needed a single revision/
		);
	});

	it('diffs a renamed file as old → new instead of a whole-file add', async () => {
		const listLines = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join('\n');
		await repo.commit('old-name.txt', `${listLines}\n`, 'add file');
		await repo.git('mv', 'old-name.txt', 'new-name.txt');
		await repo.commit('new-name.txt', `${listLines}\ntail\n`, 'rename and touch');
		const hash = (await repo.git('rev-parse', 'HEAD')).trim();

		const withOldPath = await getFileDiff(executor, repo.cwd, {
			path: 'new-name.txt',
			oldPath: 'old-name.txt',
			hash,
			context: 3,
		});
		// Rename detected: only the touched tail shows as a change, not all 30 lines.
		const added = withOldPath.listHunks
			.flatMap((hunk) => hunk.listLines)
			.filter((line) => line.kind === 'add');
		expect(added.length).toBe(1);
		expect(added[0].text).toBe('tail');
	});

	it('reports a binary file as a notice instead of hunks', async () => {
		await repo.commit('bin.dat', '\u0000\u0001\u0002', 'binary');
		const hash = (await repo.git('rev-parse', 'HEAD')).trim();
		const result = await getFileDiff(executor, repo.cwd, {
			path: 'bin.dat',
			hash,
			context: 3,
		});
		expect(result.listHunks).toEqual([]);
		expect(result.notice).toMatch(/Binary/);
	});
});
