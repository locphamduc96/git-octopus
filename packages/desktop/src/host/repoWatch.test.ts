import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefreshKind } from '@git-octopus/host/core/refreshPolicy';
import { GitProcessExecutor } from '@git-octopus/host/adapters/process/gitProcessExecutor';
import type { RepoWatchPaths } from './fsRepoWatcher.js';
import {
	createRepoWatchSupervisor,
	RepoWatchSupervisor,
	resolveWatchPaths,
	type RepoWatchSupervisorDeps,
	type WatcherHandle,
} from './repoWatch.js';

function git(cwd: string, ...listArgs: string[]): string {
	return execFileSync('git', listArgs, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t',
		},
	}).trim();
}

describe('resolveWatchPaths', () => {
	let root = '';
	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'git-octopus-watchpaths-')));
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it('is the worktree, its .git and the same .git as the common dir in a plain repository', async () => {
		const repo = path.join(root, 'repo');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		expect(await resolveWatchPaths(new GitProcessExecutor(), repo)).toEqual({
			worktree: repo,
			gitDir: path.join(repo, '.git'),
			commonDir: path.join(repo, '.git'),
		});
	});

	it('finds the main repository’s refs from a linked worktree', async () => {
		const repo = path.join(root, 'repo');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
		const linked = path.join(root, 'linked');
		git(repo, 'worktree', 'add', '-q', '-b', 'topic', linked);
		const paths = await resolveWatchPaths(new GitProcessExecutor(), linked);
		expect(paths.worktree).toBe(linked);
		expect(paths.gitDir).toBe(path.join(repo, '.git', 'worktrees', 'linked'));
		expect(paths.commonDir).toBe(path.join(repo, '.git'));
	});

	it('resolves the same folders from a subfolder of the repository', async () => {
		const repo = path.join(root, 'repo');
		fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
		git(repo, 'init', '-q', '-b', 'main');
		const paths = await resolveWatchPaths(new GitProcessExecutor(), path.join(repo, 'src'));
		expect(paths.worktree).toBe(repo);
		expect(paths.commonDir).toBe(path.join(repo, '.git'));
	});

	it('keeps trailing whitespace in a folder name', async () => {
		const repo = path.join(root, 'repo ');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		expect(await resolveWatchPaths(new GitProcessExecutor(), repo)).toEqual({
			worktree: repo,
			gitDir: path.join(repo, '.git'),
			commonDir: path.join(repo, '.git'),
		});
	});

	it('rejects for a folder that is no repository', async () => {
		const plain = path.join(root, 'plain');
		fs.mkdirSync(plain);
		await expect(resolveWatchPaths(new GitProcessExecutor(), plain)).rejects.toThrow();
	});
});

function fakeSupervisor(
	resolve: (repo: string) => Promise<RepoWatchPaths> = (repo) =>
		Promise.resolve({ worktree: repo, gitDir: `${repo}/.git`, commonDir: `${repo}/.git` })
) {
	const listCreated: { paths: RepoWatchPaths; closed: boolean }[] = [];
	const listErrors: string[] = [];
	const listKinds: RefreshKind[] = [];
	const deps: RepoWatchSupervisorDeps = {
		resolvePaths: resolve,
		createWatcher: (paths) => {
			const entry = { paths, closed: false };
			listCreated.push(entry);
			const handle: WatcherHandle = {
				close: () => {
					entry.closed = true;
				},
			};
			return handle;
		},
		onChange: (kind) => listKinds.push(kind),
		onError: (error, watched) => listErrors.push(`${watched}: ${error.message}`),
	};
	return { supervisor: new RepoWatchSupervisor(deps), listCreated, listErrors, listKinds };
}

describe('RepoWatchSupervisor', () => {
	it('starts a watcher on the repository it is told about', async () => {
		const { supervisor, listCreated } = fakeSupervisor();
		await supervisor.follow('/work/a');
		expect(listCreated.map((entry) => entry.paths.worktree)).toEqual(['/work/a']);
		expect(supervisor.watching).toBe('/work/a');
	});

	it('does nothing when told about the repository it already watches', async () => {
		const { supervisor, listCreated } = fakeSupervisor();
		await supervisor.follow('/work/a');
		await supervisor.follow('/work/a');
		expect(listCreated).toHaveLength(1);
	});

	it('closes the old watcher and starts a new one when the repository changes', async () => {
		const { supervisor, listCreated } = fakeSupervisor();
		await supervisor.follow('/work/a');
		await supervisor.follow('/work/b');
		expect(listCreated.map((entry) => [entry.paths.worktree, entry.closed])).toEqual([
			['/work/a', true],
			['/work/b', false],
		]);
	});

	it('stops watching when there is no repository', async () => {
		const { supervisor, listCreated } = fakeSupervisor();
		await supervisor.follow('/work/a');
		await supervisor.follow(null);
		expect(listCreated[0].closed).toBe(true);
		expect(supervisor.watching).toBeNull();
	});

	it('drops a watcher whose repository was left while its folders were being resolved', async () => {
		const mapGates = new Map<string, () => void>();
		const { supervisor, listCreated } = fakeSupervisor(
			(repo) =>
				new Promise((resolve) =>
					mapGates.set(repo, () =>
						resolve({ worktree: repo, gitDir: `${repo}/.git`, commonDir: `${repo}/.git` })
					)
				)
		);
		const first = supervisor.follow('/work/a');
		const second = supervisor.follow('/work/b');
		mapGates.get('/work/b')?.();
		await second;
		mapGates.get('/work/a')?.();
		await first;
		expect(listCreated.map((entry) => entry.paths.worktree)).toEqual(['/work/b']);
	});

	it('reports a repository whose folders cannot be resolved, and tries again next time', async () => {
		let works = false;
		const { supervisor, listCreated, listErrors } = fakeSupervisor((repo) =>
			works
				? Promise.resolve({ worktree: repo, gitDir: `${repo}/.git`, commonDir: `${repo}/.git` })
				: Promise.reject(new Error('no git'))
		);
		await supervisor.follow('/work/a');
		expect(listErrors).toEqual(['/work/a: no git']);
		expect(listCreated).toHaveLength(0);
		works = true;
		await supervisor.follow('/work/a');
		expect(listCreated).toHaveLength(1);
	});

	it('closes its watcher on close and starts nothing afterwards', async () => {
		const { supervisor, listCreated } = fakeSupervisor();
		await supervisor.follow('/work/a');
		supervisor.close();
		expect(listCreated[0].closed).toBe(true);
		await supervisor.follow('/work/b');
		expect(listCreated).toHaveLength(1);
	});
});

describe('createRepoWatchSupervisor on a real repository', () => {
	let root = '';
	let repo = '';
	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'git-octopus-supervise-')));
		repo = path.join(root, 'repo');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it('reports a file edited outside the app as a status change, and a commit as a graph change', async () => {
		const listKinds: RefreshKind[] = [];
		const listErrors: Error[] = [];
		const supervisor = createRepoWatchSupervisor({
			executor: new GitProcessExecutor(),
			onChange: (kind) => listKinds.push(kind),
			onError: (error) => listErrors.push(error),
		});
		try {
			await supervisor.follow(repo);
			// A stream macOS has only just opened can miss a change made at once, so the change is made
			// again until the watcher has seen one — the test is of the wiring, not of FSEvents' start-up.
			let edits = 0;
			await vi.waitFor(
				() => {
					fs.writeFileSync(path.join(repo, 'note.txt'), `changed outside ${edits++}\n`);
					expect(listKinds).toContain('status');
				},
				{ timeout: 12_000, interval: 400 }
			);
			expect(listKinds).not.toContain('graph');

			git(repo, 'add', 'note.txt');
			await vi.waitFor(
				() => {
					git(repo, 'commit', '-q', '--allow-empty', '-m', `commit ${edits++}`);
					expect(listKinds).toContain('graph');
				},
				{ timeout: 12_000, interval: 400 }
			);
			expect(listErrors).toEqual([]);
		} finally {
			supervisor.close();
		}
	}, 30_000);
});
