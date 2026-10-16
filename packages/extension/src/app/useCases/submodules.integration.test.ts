import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileDiffMessage, RepoInfo } from '@git-octopus/shared';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor.js';
import { readBlob } from '../../adapters/process/blobReader.js';
import { pathExists } from '../../adapters/fs/pathExists.js';
import { findRepos, withSubmodules } from '../../adapters/fs/repoScanner.js';
import { getCommitDetails, getStatus } from '../../core/git/gitService.js';
import { getSubmodulePaths } from '../../core/git/submodules.js';
import { createTempRepo, type TempRepo } from '../../test/tempRepo.js';
import { loadFileDiff } from './loadFileDiff.js';

/**
 * A real superproject with a real submodule, cloned from a second temporary repository. The
 * machine's global config is shut out — `submodule.recurse` or `diff.submodule` there would change
 * what git prints.
 */
describe('submodules (real git)', () => {
	const executor = new GitProcessExecutor();
	let engine: TempRepo;
	let game: TempRepo;
	let configDir: string;
	let previousGlobal: string | undefined;
	let listRepos: RepoInfo[];
	const subDir = () => path.join(game.cwd, 'libs', 'engine');
	const inSub = (...listArgs: string[]) => game.git('-C', subDir(), ...listArgs);

	beforeAll(async () => {
		configDir = await mkdtemp(path.join(tmpdir(), 'git-octopus-sub-'));
		previousGlobal = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = path.join(configDir, 'gitconfig');
		await writeFile(process.env.GIT_CONFIG_GLOBAL, '');
		engine = await createTempRepo();
		await engine.commit('engine.ts', 'export const v = 1;\n', 'engine v1');
		game = await createTempRepo();
		await game.commit('README.md', '# game\n', 'first');
		await game.git(
			'-c',
			'protocol.file.allow=always',
			'submodule',
			'add',
			'-q',
			engine.cwd,
			'libs/engine'
		);
		await game.git('commit', '-qm', 'add engine');
		listRepos = await withSubmodules(await findRepos([game.cwd]), (repoPath) =>
			getSubmodulePaths(executor, repoPath)
		);
	});

	afterAll(async () => {
		if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
		await game.dispose();
		await engine.dispose();
		await rm(configDir, { recursive: true, force: true });
	});

	const load = (over: Record<string, unknown>) =>
		loadFileDiff(
			{
				executor,
				repos: listRepos,
				cwd: game.cwd,
				repoName: 'game',
				pathExists,
				readBlob,
			},
			{ type: 'loadFileDiff', key: 'k', path: 'libs/engine', context: 3, ...over }
		) as Promise<FileDiffMessage>;

	it('lists the checked-out submodule after the repository that records it', () => {
		expect(listRepos.map((repo) => repo.path)).toEqual([game.cwd, subDir()]);
		expect(listRepos[1]).toMatchObject({ parent: game.cwd, subPath: 'libs/engine' });
	});

	it('marks the submodule among a commit’s files, and diffs it as a pointer', async () => {
		const head = (await game.git('rev-parse', 'HEAD')).trim();
		const details = await getCommitDetails(executor, game.cwd, head);
		expect(details.files).toContainEqual(
			expect.objectContaining({ path: 'libs/engine', status: 'A', submodule: {} })
		);
		expect(details.files.find((file) => file.path === '.gitmodules')).not.toHaveProperty(
			'submodule'
		);

		const engineHead = (await engine.git('rev-parse', 'HEAD')).trim();
		const diff = await load({ hash: head });
		expect(diff.submodule).toEqual({ to: engineHead, dirty: false, repoPath: subDir() });
		expect(diff.listHunks).toEqual([]);
	});

	it('reports a new commit inside the checkout, and the pointer move it makes', async () => {
		const before = (await inSub('rev-parse', 'HEAD')).trim();
		await writeFile(path.join(subDir(), 'engine.ts'), 'export const v = 2;\n');
		await inSub('commit', '-qam', 'engine v2');
		const after = (await inSub('rev-parse', 'HEAD')).trim();

		const { unstaged } = (await getStatus(executor, game.cwd)).working;
		expect(unstaged).toContainEqual({
			status: 'M',
			path: 'libs/engine',
			submodule: { commitChanged: true, modified: false, untracked: false },
		});
		const diff = await load({ side: 'unstaged' });
		expect(diff.submodule).toEqual({ from: before, to: after, dirty: false, repoPath: subDir() });
	});

	it('sees edits inside the checkout that the superproject cannot record', async () => {
		await writeFile(path.join(subDir(), 'engine.ts'), 'export const v = 3;\n');
		await writeFile(path.join(subDir(), 'scratch.txt'), 'x\n');
		const { unstaged } = (await getStatus(executor, game.cwd)).working;
		expect(unstaged.find((file) => file.path === 'libs/engine')?.submodule).toEqual({
			commitChanged: true,
			modified: true,
			untracked: true,
		});
		expect((await load({ side: 'unstaged' })).submodule?.dirty).toBe(true);
	});

	it('leaves out a submodule that was never checked out', async () => {
		const clone = await mkdtemp(path.join(tmpdir(), 'git-octopus-sub-clone-'));
		try {
			await game.git('clone', '-q', game.cwd, clone);
			const listCloneRepos = await withSubmodules(await findRepos([clone]), (repoPath) =>
				getSubmodulePaths(executor, repoPath)
			);
			expect(listCloneRepos.map((repo) => repo.path)).toEqual([clone]);
		} finally {
			await rm(clone, { recursive: true, force: true });
		}
	});
});
