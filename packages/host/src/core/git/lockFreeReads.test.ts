import { createHash } from 'node:crypto';
import { access, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { LockRetryGitExecutor } from '../../adapters/process/lockRetryGitExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import {
	getAheadBehind,
	getBranchEntries,
	getCommitDetails,
	getCommits,
	getComparison,
	getCurrentBranch,
	getFileAtRev,
	getFileDiff,
	getHeadHash,
	getPreviousBranch,
	getRemoteNames,
	getRepoIdentity,
	getRepoState,
	getStashes,
	getStatus,
	getSubmodules,
	getTags,
} from './gitService';
import {
	EMPTY_TREE,
	promptDiffArgs,
	promptNumstatArgs,
	workingTreeDiffArgs,
} from './workingTreeDiff';

/**
 * Feature 076: nothing this extension runs to *read* may write `.git/index`.
 *
 * A read that rewrites the index takes `.git/index.lock` to do it, and for that moment every commit
 * — here, in another window, in another client — fails. These run the real read paths against a
 * real repository whose stat cache is deliberately stale (the only state in which git wants to
 * write), and fail if the index moved. A new read that reaches for porcelain `git diff HEAD` lands
 * here before it lands in a release.
 */

const executor = new GitProcessExecutor();

interface IndexSnapshot {
	ino: number;
	mtimeMs: number;
	sha: string;
}

async function snapshotIndex(cwd: string): Promise<IndexSnapshot> {
	const file = path.join(cwd, '.git', 'index');
	const info = await stat(file);
	return {
		ino: info.ino,
		mtimeMs: info.mtimeMs,
		sha: createHash('sha1')
			.update(await readFile(file))
			.digest('hex'),
	};
}

/** Move a file's mtime without touching its content — what an editor or a Cocos import does. */
async function makeStatDirty(cwd: string, fileName: string): Promise<void> {
	const past = new Date(Date.now() - 100_000);
	await utimes(path.join(cwd, fileName), past, past);
}

/**
 * Every shape the diff pipeline has to handle, left uncommitted: an edit, a deletion, a staged
 * rename with an edit on top, a staged new file, a binary, a non-ASCII and a spaced path, an
 * untracked file, and two tracked files whose stat cache is stale.
 */
async function buildFixture(repo: TempRepo): Promise<{ first: string; second: string }> {
	const lines = (name: string): string => `${name}\n${'line\n'.repeat(20)}`;
	for (const name of ['keep.ts', 'edit.ts', 'gone.ts', 'old name.ts', 'touch.ts', 'héllo.ts']) {
		await writeFile(path.join(repo.cwd, name), lines(name));
	}
	await writeFile(
		path.join(repo.cwd, 'bin.dat'),
		Buffer.from(Array.from({ length: 256 }, (_, i) => i))
	);
	await repo.git('add', '-A');
	await repo.git('commit', '-m', 'first');
	const first = (await repo.git('rev-parse', 'HEAD')).trim();
	const second = await repo.commit('edit.ts', `${lines('edit.ts')}second\n`, 'second');

	await writeFile(path.join(repo.cwd, 'edit.ts'), `${lines('edit.ts')}second\nthird\n`);
	await rm(path.join(repo.cwd, 'gone.ts'));
	await repo.git('mv', 'old name.ts', 'new name.ts');
	await writeFile(path.join(repo.cwd, 'new name.ts'), `${lines('old name.ts')}tail\n`);
	await writeFile(path.join(repo.cwd, 'staged.ts'), 'new\n');
	await repo.git('add', 'staged.ts');
	await writeFile(path.join(repo.cwd, 'héllo.ts'), `${lines('héllo.ts')}x\n`);
	await writeFile(
		path.join(repo.cwd, 'bin.dat'),
		Buffer.from(Array.from({ length: 256 }, (_, i) => 255 - i))
	);
	await writeFile(path.join(repo.cwd, 'untracked.ts'), 'u\n');
	await makeStatDirty(repo.cwd, 'keep.ts');
	await makeStatDirty(repo.cwd, 'touch.ts');
	return { first, second };
}

/** Everything the graph, the changes panel, the diff view and the AI prompt read. */
async function runEveryRead(cwd: string, first: string, second: string): Promise<void> {
	const exists = (file: string): Promise<boolean> =>
		access(file).then(
			() => true,
			() => false
		);
	await getStatus(executor, cwd);
	await getCommits(
		executor,
		cwd,
		100,
		{ branch: null, showRemoteBranches: true, showTags: true },
		true
	);
	await getBranchEntries(executor, cwd, 'refs/heads');
	await getTags(executor, cwd);
	await getStashes(executor, cwd);
	await getRemoteNames(executor, cwd);
	await getSubmodules(executor, cwd);
	await getCurrentBranch(executor, cwd);
	await getPreviousBranch(executor, cwd);
	await getAheadBehind(executor, cwd);
	await getRepoState(executor, cwd, exists);
	await getHeadHash(executor, cwd);
	await getRepoIdentity(executor, cwd);
	await getCommitDetails(executor, cwd, second);
	await getComparison(executor, cwd, first, second);
	await getFileAtRev(executor, cwd, second, 'edit.ts');
	for (const request of [
		{ path: 'edit.ts', context: 3 },
		{ path: 'touch.ts', context: 3 },
		{ path: 'edit.ts', context: 1_000_000 },
		{ path: 'new name.ts', oldPath: 'old name.ts', context: 3 },
		{ path: 'héllo.ts', context: 3 },
		{ path: 'untracked.ts', untracked: true, context: 3 },
		{ path: 'edit.ts', hash: second, context: 3 },
		{ path: 'edit.ts', fromHash: first, toHash: second, context: 3 },
	]) {
		await getFileDiff(executor, cwd, request);
	}
	await executor.run(promptNumstatArgs(), cwd);
	await executor.run(
		promptDiffArgs(['edit.ts', 'keep.ts', 'touch.ts', 'héllo.ts', 'staged.ts', 'bin.dat']),
		cwd
	);
}

describe('reads never write the index', () => {
	let repo: TempRepo;

	beforeEach(async () => {
		repo = await createTempRepo();
	});

	afterEach(async () => {
		await repo.dispose();
	});

	it('leaves .git/index byte-for-byte alone while the stat cache is stale', async () => {
		const { first, second } = await buildFixture(repo);
		const before = await snapshotIndex(repo.cwd);

		await runEveryRead(repo.cwd, first, second);

		expect(await snapshotIndex(repo.cwd)).toEqual(before);
	});

	it('still reads everything while an orphaned index.lock sits in the repository', async () => {
		const { first, second } = await buildFixture(repo);
		await writeFile(path.join(repo.cwd, '.git', 'index.lock'), '');

		await expect(runEveryRead(repo.cwd, first, second)).resolves.toBeUndefined();
		const diff = await getFileDiff(executor, repo.cwd, { path: 'edit.ts', context: 3 });
		expect(diff.listHunks.length).toBeGreaterThan(0);
	});

	it('diffs a staged file against the empty tree before the first commit, without writing', async () => {
		await writeFile(path.join(repo.cwd, 'first.ts'), 'one\ntwo\n');
		await repo.git('add', 'first.ts');
		await makeStatDirty(repo.cwd, 'first.ts');
		const before = await snapshotIndex(repo.cwd);

		const diff = await getFileDiff(executor, repo.cwd, { path: 'first.ts', context: 3 });

		expect(diff.listHunks.length).toBeGreaterThan(0);
		expect(await snapshotIndex(repo.cwd)).toEqual(before);
	});
});

/**
 * The plumbing forms must say exactly what the porcelain ones said, or the swap changed behaviour.
 * The porcelain side runs second in each case because it is the one that rewrites the index.
 */
describe('diff-index matches the porcelain diff it replaced', () => {
	let repo: TempRepo;

	beforeEach(async () => {
		repo = await createTempRepo();
		await buildFixture(repo);
	});

	afterEach(async () => {
		await repo.dispose();
	});

	const quote = ['-c', 'core.quotePath=false'];
	const listPaths = [
		'edit.ts',
		'keep.ts',
		'touch.ts',
		'héllo.ts',
		'staged.ts',
		'bin.dat',
		'gone.ts',
	];

	it.each([
		[
			'the prompt batch',
			promptDiffArgs(listPaths),
			[...quote, 'diff', 'HEAD', '--no-renames', '--', ...listPaths],
		],
		['the line counts', promptNumstatArgs(), [...quote, 'diff', 'HEAD', '--numstat']],
		[
			'a renamed file',
			workingTreeDiffArgs('HEAD', ['-M', '-U3'], ['old name.ts', 'new name.ts']),
			['diff', 'HEAD', '-M', '-U3', '--', 'old name.ts', 'new name.ts'],
		],
		[
			'a stat-dirty file',
			workingTreeDiffArgs('HEAD', ['-U3'], ['touch.ts']),
			['diff', 'HEAD', '-U3', '--', 'touch.ts'],
		],
		[
			'the whole-file view',
			workingTreeDiffArgs('HEAD', ['-U1000000'], ['edit.ts']),
			['diff', 'HEAD', '-U1000000', '--', 'edit.ts'],
		],
		[
			'the empty tree',
			workingTreeDiffArgs(EMPTY_TREE, ['-U3'], ['edit.ts']),
			['diff', EMPTY_TREE, '-U3', '--', 'edit.ts'],
		],
	])('%s', async (_, plumbing, porcelain) => {
		const fromPlumbing = await executor.run(plumbing, repo.cwd);
		const fromPorcelain = await executor.run(porcelain, repo.cwd);

		expect(fromPlumbing).toBe(fromPorcelain);
	});
});

describe('a write waits out a lock another process holds for a moment', () => {
	let repo: TempRepo;

	beforeEach(async () => {
		repo = await createTempRepo();
		await repo.commit('a.ts', 'a\n', 'first');
	});

	afterEach(async () => {
		await repo.dispose();
	});

	it('stages once the other process lets go, instead of failing', async () => {
		const lock = path.join(repo.cwd, '.git', 'index.lock');
		await writeFile(path.join(repo.cwd, 'a.ts'), 'a\nb\n');
		await writeFile(lock, '');
		const release = new Promise<void>((resolve) => {
			setTimeout(() => void rm(lock).then(resolve), 300);
		});

		await new LockRetryGitExecutor(executor).run(['add', '--', 'a.ts'], repo.cwd);
		await release;

		expect(await repo.git('diff', '--cached', '--name-only')).toBe('a.ts\n');
	});
});
