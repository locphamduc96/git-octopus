import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { isFirstParentRun } from './rewriteGuards';

/**
 * Against a real repository: a linear run c1 → c2 → c3 → c4 on main, plus a side branch merged
 * back in, so both the accepting and every rejecting path can be proven with real `rev-list`.
 */
describe('isFirstParentRun', () => {
	let repo: TempRepo;
	const executor = new GitProcessExecutor();
	let c1: string, c2: string, c3: string, c4: string;
	let merge: string;

	beforeAll(async () => {
		repo = await createTempRepo();
		c1 = await repo.commit('a.txt', 'one\n', 'c1');
		c2 = await repo.commit('a.txt', 'two\n', 'c2');
		c3 = await repo.commit('a.txt', 'three\n', 'c3');
		c4 = await repo.commit('a.txt', 'four\n', 'c4');
		await repo.git('checkout', '-b', 'side', c2);
		await repo.commit('b.txt', 'side\n', 'side work');
		await repo.git('checkout', 'main');
		await repo.git('merge', '--no-ff', '-m', 'merge side', 'side');
		merge = (await repo.git('rev-parse', 'HEAD')).trim();
	});

	afterAll(async () => {
		await repo.dispose();
	});

	it('accepts a contiguous newest → oldest run', async () => {
		expect(await isFirstParentRun(executor, [c4, c3, c2], repo.cwd)).toBe(true);
		expect(await isFirstParentRun(executor, [c3, c2], repo.cwd)).toBe(true);
	});

	it('rejects a run in the wrong order', async () => {
		expect(await isFirstParentRun(executor, [c2, c3, c4], repo.cwd)).toBe(false);
	});

	it('rejects a run with a gap', async () => {
		expect(await isFirstParentRun(executor, [c4, c2], repo.cwd)).toBe(false);
	});

	it('rejects a run containing the root commit', async () => {
		expect(await isFirstParentRun(executor, [c2, c1], repo.cwd)).toBe(false);
	});

	it('rejects a run containing a merge commit', async () => {
		expect(await isFirstParentRun(executor, [merge, c4], repo.cwd)).toBe(false);
	});

	it('rejects hashes the repository does not have', async () => {
		const fake = '0123456789012345678901234567890123456789';
		expect(await isFirstParentRun(executor, [fake], repo.cwd)).toBe(false);
	});

	it('rejects an empty selection', async () => {
		expect(await isFirstParentRun(executor, [], repo.cwd)).toBe(false);
	});
});
