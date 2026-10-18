import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { RefreshKind } from '@git-octopus/host/core/refreshPolicy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsRepoWatcher } from './fsRepoWatcher.js';

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

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathsFor(worktree: string) {
	return {
		worktree,
		gitDir: path.resolve(worktree, git(worktree, 'rev-parse', '--git-dir')),
		commonDir: path.resolve(worktree, git(worktree, 'rev-parse', '--git-common-dir')),
	};
}

describe('FsRepoWatcher', () => {
	let root = '';
	let repo = '';
	let listWatchers: FsRepoWatcher[] = [];
	let listKinds: RefreshKind[] = [];

	function start(worktree = repo, deps: ConstructorParameters<typeof FsRepoWatcher>[2] = {}): FsRepoWatcher {
		const watcher = new FsRepoWatcher(pathsFor(worktree), (kind) => listKinds.push(kind), deps);
		listWatchers.push(watcher);
		return watcher;
	}

	beforeEach(async () => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'git-octopus-watch-')));
		repo = path.join(root, 'repo');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '-b', 'main');
		fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', 'first');
		listKinds = [];
		listWatchers = [];
		await wait(300);
	});

	afterEach(() => {
		for (const watcher of listWatchers) watcher.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('reports one status for an edited file', async () => {
		start();
		fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
		await wait(900);
		expect(listKinds).toEqual(['status']);
	});

	it('reports graph for a commit, once, though the index and the ref both changed', async () => {
		start();
		fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', 'second');
		await wait(900);
		expect(listKinds).toEqual(['graph']);
	});

	it('collapses 50 files written within 100 ms into one notification', async () => {
		start();
		for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), String(i));
		await wait(900);
		expect(listKinds).toEqual(['status']);
	});

	it('stays quiet for .git/objects and node_modules', async () => {
		start();
		fs.mkdirSync(path.join(repo, '.git', 'objects', 'zz'), { recursive: true });
		fs.writeFileSync(path.join(repo, '.git', 'objects', 'zz', 'blob'), 'x');
		fs.mkdirSync(path.join(repo, 'node_modules', 'pkg'), { recursive: true });
		fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'x');
		await wait(900);
		expect(listKinds).toEqual([]);
	});

	it('reports status for a merge in progress file and graph for a new tag', async () => {
		start();
		fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), git(repo, 'rev-parse', 'HEAD') + '\n');
		await wait(900);
		expect(listKinds).toEqual(['status']);
		listKinds = [];
		git(repo, 'tag', 'v1');
		await wait(900);
		expect(listKinds).toEqual(['graph']);
	});

	it('leaves no live watcher and no late callback after close()', async () => {
		const listOpened: { closed: boolean }[] = [];
		const watcher = start(repo, {
			watch: ((...listArgs: Parameters<typeof fs.watch>) => {
				const real = fs.watch(...listArgs);
				const entry = { closed: false };
				listOpened.push(entry);
				const close = real.close.bind(real);
				real.close = () => {
					entry.closed = true;
					close();
				};
				return real;
			}) as typeof fs.watch,
		});
		expect(listOpened.length).toBeGreaterThan(0);
		fs.writeFileSync(path.join(repo, 'a.txt'), 'late\n');
		await wait(100);
		watcher.close();
		expect(listOpened.every((entry) => entry.closed)).toBe(true);
		fs.writeFileSync(path.join(repo, 'a.txt'), 'later\n');
		await wait(900);
		expect(listKinds).toEqual([]);
	});

	it('reports a linked worktree its own HEAD change as graph', async () => {
		const linked = path.join(root, 'linked');
		git(repo, 'worktree', 'add', '-q', '-b', 'side', linked);
		const paths = pathsFor(linked);
		expect(paths.gitDir).not.toBe(paths.commonDir);
		await wait(300);
		start(linked);
		git(linked, 'checkout', '-q', '-b', 'other');
		await wait(900);
		expect(listKinds).toEqual(['graph']);
	});

	it('reports a file edited in a linked worktree as status', async () => {
		const linked = path.join(root, 'linked');
		git(repo, 'worktree', 'add', '-q', '-b', 'side', linked);
		await wait(300);
		start(linked);
		fs.writeFileSync(path.join(linked, 'a.txt'), 'changed\n');
		await wait(900);
		expect(listKinds).toEqual(['status']);
	});
});
