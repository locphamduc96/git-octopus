import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import type { GitExecutor } from './GitExecutor';
import { getRefPanelData, parseRefs, parseStashes } from './refInventory';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

function record(refname: string, hash: string, peeled = '', head = ' '): string {
	return [refname, hash, peeled, head].join('\0');
}

describe('parseRefs', () => {
	it('keeps names with slashes and marks the checked-out branch as current', () => {
		const output = [
			record('refs/heads/feature/deep/x', A, '', '*'),
			record('refs/heads/main', B),
			record('refs/remotes/origin/feature/deep/x', A),
			record('refs/remotes/upstream/main', B),
		].join('\n');
		expect(parseRefs(output)).toEqual({
			listLocal: [
				{ name: 'feature/deep/x', hash: A },
				{ name: 'main', hash: B },
			],
			listRemote: [
				{ name: 'origin/feature/deep/x', hash: A, remote: 'origin' },
				{ name: 'upstream/main', hash: B, remote: 'upstream' },
			],
			listTags: [],
			current: 'feature/deep/x',
		});
	});

	it('skips the symbolic <remote>/HEAD', () => {
		const output = [
			record('refs/remotes/origin/HEAD', A),
			record('refs/remotes/origin/main', A),
			record('refs/remotes/origin', A),
		].join('\n');
		expect(parseRefs(output).listRemote).toEqual([
			{ name: 'origin/main', hash: A, remote: 'origin' },
		]);
	});

	it('resolves an annotated tag to the commit it peels to, a lightweight one to itself', () => {
		const output = [record('refs/tags/v1.0', B, A), record('refs/tags/release/light', C)].join(
			'\n'
		);
		expect(parseRefs(output).listTags).toEqual([
			{ name: 'v1.0', hash: A },
			{ name: 'release/light', hash: C },
		]);
	});

	it('has no current branch when HEAD is detached', () => {
		expect(parseRefs(record('refs/heads/main', A)).current).toBeNull();
	});

	it('answers empty lists for no refs at all', () => {
		expect(parseRefs('')).toEqual({ listLocal: [], listRemote: [], listTags: [], current: null });
	});
});

describe('parseStashes', () => {
	it('reads selector, hash and subject', () => {
		const output = [
			`stash@{0}\0${A}\0WIP on main: 1234567 first`,
			`stash@{1}\0${B}\0On main: with: colon`,
		].join('\n');
		expect(parseStashes(output)).toEqual([
			{ selector: 'stash@{0}', hash: A, message: 'WIP on main: 1234567 first' },
			{ selector: 'stash@{1}', hash: B, message: 'On main: with: colon' },
		]);
	});

	it('answers nothing when there is no stash', () => {
		expect(parseStashes('')).toEqual([]);
	});
});

describe('getRefPanelData', () => {
	it('asks git once for refs and once for stashes', async () => {
		const listCalls: string[][] = [];
		const executor: GitExecutor = {
			run: (args) => {
				listCalls.push(args);
				return Promise.resolve(
					args[0] === 'stash' ? `stash@{0}\0${A}\0WIP` : record('refs/heads/main', A, '', '*')
				);
			},
		};
		const data = await getRefPanelData(executor, '/repo');
		expect(listCalls.map((args) => args[0])).toEqual(['for-each-ref', 'stash']);
		expect(data.current).toBe('main');
		expect(data.listStashes).toEqual([{ selector: 'stash@{0}', hash: A, message: 'WIP' }]);
	});

	it('answers empty lists when git fails', async () => {
		const executor: GitExecutor = { run: () => Promise.reject(new Error('not a repo')) };
		expect(await getRefPanelData(executor, '/nowhere')).toEqual({
			listLocal: [],
			listRemote: [],
			listTags: [],
			listStashes: [],
			current: null,
		});
	});
});

describe('getRefPanelData against real git', () => {
	let repo: TempRepo;
	const executor = new GitProcessExecutor();

	beforeAll(async () => {
		repo = await createTempRepo();
	});

	afterAll(async () => {
		await repo.dispose();
	});

	it('lists a repository with no refs without error', async () => {
		expect(await getRefPanelData(executor, repo.cwd)).toEqual({
			listLocal: [],
			listRemote: [],
			listTags: [],
			listStashes: [],
			current: null,
		});
	});

	it('reads branches, an annotated tag peeled to its commit, and a stash', async () => {
		const first = await repo.commit('a.txt', 'one\n', 'first');
		await repo.git('branch', 'feature/x');
		await repo.git('tag', '-a', 'v1.0', '-m', 'release');
		await repo.git('update-ref', 'refs/remotes/origin/main', first);
		await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
		await repo.commit('a.txt', 'two\n', 'second');
		await writeFile(`${repo.cwd}/a.txt`, 'dirty\n');
		await repo.git('stash', 'push', '-m', 'parked');

		const data = await getRefPanelData(executor, repo.cwd);
		expect(data.current).toBe('main');
		expect(data.listLocal.map((ref) => ref.name)).toEqual(['feature/x', 'main']);
		expect(data.listRemote).toEqual([{ name: 'origin/main', hash: first, remote: 'origin' }]);
		expect(data.listTags).toEqual([{ name: 'v1.0', hash: first }]);
		expect(data.listStashes).toHaveLength(1);
		expect(data.listStashes[0]).toMatchObject({
			selector: 'stash@{0}',
			message: 'On main: parked',
		});
	});
});
