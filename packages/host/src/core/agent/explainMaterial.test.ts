import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor.js';
import { createTempRepo } from '../../test/tempRepo.js';
import { gatherExplainMaterial, parseExplainLog, parseNameStatus } from './explainMaterial.js';

const executor = new GitProcessExecutor();
const NO_EXCLUDES = { listExcludePatterns: [] };

describe('parsers', () => {
	it('reads log records with multi-line bodies', () => {
		expect(parseExplainLog('aaa\0Ada\0one\0line 1\nline 2\n\x1e\nbbb\0Bo\0two\0\x1e')).toEqual([
			{ hash: 'aaa', author: 'Ada', subject: 'one', body: 'line 1\nline 2' },
			{ hash: 'bbb', author: 'Bo', subject: 'two', body: '' },
		]);
	});

	it('reads name-status lines, tabs in paths included', () => {
		expect(parseNameStatus('M\tsrc/a.ts\nA\tweird\tname\n')).toEqual([
			{ status: 'M', path: 'src/a.ts' },
			{ status: 'A', path: 'weird\tname' },
		]);
	});
});

describe('gatherExplainMaterial against a real repository', () => {
	it('explains a merge by what it brought in, with diffs', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.git('checkout', '-b', 'side');
			await repo.commit('s.txt', 'side\n', 'side work');
			await repo.git('checkout', 'main');
			await repo.commit('a.txt', 'a2\n', 'main work');
			await repo.git('merge', '--no-ff', '-m', 'merge side', 'side');
			const merge = (await repo.git('rev-parse', 'HEAD')).trim();

			const material = await gatherExplainMaterial(
				executor,
				repo.cwd,
				{ kind: 'commit', hash: merge },
				NO_EXCLUDES
			);
			expect(material.title).toBe(`commit ${merge.slice(0, 8)} — merge side`);
			expect(material.listFiles.map((file) => file.path)).toEqual(['s.txt']);
			expect(material.listFiles[0].diff).toContain('+side');
		} finally {
			await repo.dispose();
		}
	});

	it('explains the root commit against nothing', async () => {
		const repo = await createTempRepo();
		try {
			const root = await repo.commit('a.txt', 'a\n', 'root');
			const material = await gatherExplainMaterial(
				executor,
				repo.cwd,
				{ kind: 'commit', hash: root },
				NO_EXCLUDES
			);
			expect(material.listFiles).toMatchObject([{ path: 'a.txt', status: 'A', additions: 1 }]);
		} finally {
			await repo.dispose();
		}
	});

	it('explains a branch against the checked-out one, from their merge base', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.git('checkout', '-b', 'feature');
			await repo.commit('f1.txt', '1\n', 'feat: one');
			await repo.commit('f2.txt', '2\n', 'feat: two');
			await repo.git('checkout', 'main');
			await repo.commit('m.txt', 'm\n', 'main moved on');

			const material = await gatherExplainMaterial(
				executor,
				repo.cwd,
				{ kind: 'branch', ref: 'refs/heads/feature', label: 'feature' },
				NO_EXCLUDES
			);
			expect(material.title).toBe('branch feature — 2 commits not on main');
			expect(material.listCommits.map((commit) => commit.subject)).toEqual([
				'feat: one',
				'feat: two',
			]);
			expect(material.listFiles.map((file) => file.path).sort()).toEqual(['f1.txt', 'f2.txt']);
		} finally {
			await repo.dispose();
		}
	});

	it('explains the checked-out branch against main', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.git('checkout', '-b', 'feature');
			await repo.commit('f.txt', 'f\n', 'feat: on feature');
			const material = await gatherExplainMaterial(
				executor,
				repo.cwd,
				{ kind: 'branch', ref: 'refs/heads/feature', label: 'feature' },
				NO_EXCLUDES
			);
			expect(material.title).toBe('branch feature — 1 commit not on main');
		} finally {
			await repo.dispose();
		}
	});

	it('refuses a branch with nothing of its own', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.git('branch', 'same');
			await expect(
				gatherExplainMaterial(
					executor,
					repo.cwd,
					{ kind: 'branch', ref: 'refs/heads/same', label: 'same' },
					NO_EXCLUDES
				)
			).rejects.toThrow('same has no commits that main does not have.');
		} finally {
			await repo.dispose();
		}
	});

	it('explains uncommitted work, new files included, and keeps excluded content home', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.commit('secret.env', 'KEY=1\n', 'env');
			await writeFile(path.join(repo.cwd, 'a.txt'), 'a changed\n');
			await writeFile(path.join(repo.cwd, 'secret.env'), 'KEY=2\n');
			await writeFile(path.join(repo.cwd, 'new.txt'), 'brand new\n');
			await repo.git('add', 'a.txt');

			const material = await gatherExplainMaterial(
				executor,
				repo.cwd,
				{ kind: 'working' },
				{ listExcludePatterns: ['*.env'] }
			);
			expect(material.title).toBe('uncommitted changes on main');
			const mapByPath = new Map(material.listFiles.map((file) => [file.path, file]));
			expect(mapByPath.get('a.txt')?.diff).toContain('+a changed');
			expect(mapByPath.get('new.txt')?.diff).toContain('+brand new');
			expect(mapByPath.get('secret.env')).toMatchObject({ tier: 'excluded' });
			expect(mapByPath.get('secret.env')?.diff).toBeUndefined();
		} finally {
			await repo.dispose();
		}
	});
});
