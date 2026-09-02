import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepoWatcher, type RefreshKind } from './RepoWatcher.js';
import { fireWindowState, listWatchers, resetRecorded } from '../../test/vscodeStub.js';

const DEBOUNCE_MS = 400;

const listTempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-octopus-watch-'));
	listTempDirs.push(dir);
	return dir;
}

/** A repository whose `.git` is a real directory — the ordinary case. */
async function plainRepo(): Promise<string> {
	const repo = await tempDir();
	await fs.mkdir(path.join(repo, '.git'));
	return repo;
}

/**
 * A worktree: `.git` is a *file* pointing at the real git dir, and that dir's `commondir` names
 * where the shared refs live.
 */
async function worktreeRepo(
	options: {
		/** Write `commondir` pointing at the shared `.git` — what git does for a real worktree. */
		shared?: boolean;
		/** Write `commondir` as `.`, i.e. resolving back to the worktree's own git dir. */
		selfCommondir?: boolean;
		/** Write the gitdir pointer relative to the repository rather than absolute. */
		relativePointer?: boolean;
	} = {}
): Promise<{ repo: string; gitDir: string; commonDir: string }> {
	const root = await tempDir();
	const repo = path.join(root, 'wt');
	const commonDir = path.join(root, 'main', '.git');
	const gitDir = path.join(commonDir, 'worktrees', 'wt');
	await fs.mkdir(repo, { recursive: true });
	await fs.mkdir(gitDir, { recursive: true });
	const pointer = options.relativePointer ? path.relative(repo, gitDir) : gitDir;
	await fs.writeFile(path.join(repo, '.git'), `gitdir: ${pointer}\n`);
	if (options.shared) {
		await fs.writeFile(path.join(gitDir, 'commondir'), `${path.relative(gitDir, commonDir)}\n`);
	}
	if (options.selfCommondir) await fs.writeFile(path.join(gitDir, 'commondir'), '.\n');
	return { repo, gitDir, commonDir };
}

/**
 * `watch()` kicks off `createWatchers` with `void`, and that walks real files — so a test has to
 * wait for the watchers to appear rather than for a fixed number of microtasks. Polls on real
 * timers, before any test installs fake ones.
 */
async function settle(expected = 1): Promise<void> {
	for (let i = 0; i < 200 && listWatchers.length < expected; i++) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	// One more turn so a second watcher from the same pass is in before the assertion.
	await new Promise((resolve) => setTimeout(resolve, 1));
}

let listRefreshes: RefreshKind[];
let watcher: RepoWatcher;

beforeEach(() => {
	resetRecorded();
	listRefreshes = [];
	watcher = new RepoWatcher((kind) => listRefreshes.push(kind));
});

afterEach(async () => {
	watcher.dispose();
	vi.useRealTimers();
	for (const dir of listTempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

describe('RepoWatcher.watch', () => {
	it('roots one watcher at .git for an ordinary repository', async () => {
		const repo = await plainRepo();

		watcher.watch(repo);
		await settle();

		expect(listWatchers).toHaveLength(1);
		expect(listWatchers[0].pattern.base).toBe(path.join(repo, '.git'));
	});

	it('follows a gitdir pointer file instead of watching the file itself', async () => {
		// A glob rooted at a file matches no events, so a worktree would be watched by nothing.
		const { repo, gitDir } = await worktreeRepo();

		watcher.watch(repo);
		await settle();

		expect(listWatchers.map((entry) => entry.pattern.base)).toEqual([gitDir]);
	});

	it('resolves a relative gitdir pointer against the repository', async () => {
		const { repo, gitDir } = await worktreeRepo({ relativePointer: true });

		watcher.watch(repo);
		await settle();

		expect(listWatchers.map((entry) => entry.pattern.base)).toEqual([gitDir]);
	});

	it('watches both dirs when commondir points the refs somewhere else', async () => {
		// A worktree's own git dir holds only its HEAD and sequencer state; the refs live in the
		// shared dir. Miss it and the graph never auto-refreshes inside a worktree.
		const { repo, gitDir, commonDir } = await worktreeRepo({ shared: true });

		watcher.watch(repo);
		await settle(2);

		expect(listWatchers.map((entry) => entry.pattern.base).sort()).toEqual(
			[gitDir, commonDir].sort()
		);
	});

	it('watches one dir when commondir resolves back to the git dir itself', async () => {
		const { repo, gitDir } = await worktreeRepo({ selfCommondir: true });

		watcher.watch(repo);
		await settle();

		expect(listWatchers.map((entry) => entry.pattern.base)).toEqual([gitDir]);
	});

	it('creates nothing for a path with no .git at all', async () => {
		const repo = await tempDir();

		watcher.watch(repo);
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(listWatchers).toHaveLength(0);
	});

	it('disposes the previous watchers when the repository changes', async () => {
		const first = await plainRepo();
		const second = await plainRepo();

		watcher.watch(first);
		await settle();
		const [firstWatcher] = listWatchers;

		watcher.watch(second);
		await settle(2);

		expect(firstWatcher.disposed).toBe(true);
		expect(listWatchers[listWatchers.length - 1].pattern.base).toBe(path.join(second, '.git'));
	});

	it('stops watching when told to watch nothing', async () => {
		const repo = await plainRepo();
		watcher.watch(repo);
		await settle();

		watcher.watch(null);

		expect(listWatchers[0].disposed).toBe(true);
	});
});

describe('RepoWatcher events', () => {
	beforeEach(async () => {
		const repo = await plainRepo();
		watcher.watch(repo);
		await settle();
		vi.useFakeTimers();
	});

	it('ignores the lock files git writes around every operation', () => {
		listWatchers[0].fire('create', '/repo/.git/index.lock');
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual([]);
	});

	it('asks for a status pass when the index is touched', () => {
		listWatchers[0].fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['status']);
	});

	it('asks for a graph reload when a ref moves', () => {
		listWatchers[0].fire('change', path.join('/repo', '.git', 'refs', 'heads', 'main'));
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['graph']);
	});

	it('reports a deletion the same way as a change', () => {
		listWatchers[0].fire('delete', path.join('/repo', '.git', 'refs', 'heads', 'gone'));
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['graph']);
	});

	it('collapses a burst into one refresh', () => {
		// A build writes files in bursts; one reload per file would spend the day recovering.
		const [entry] = listWatchers;
		entry.fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(100);
		entry.fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(100);
		entry.fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['status']);
	});

	it('upgrades a collapsed burst to graph when any event in it was a ref', () => {
		const [entry] = listWatchers;
		entry.fire('change', path.join('/repo', '.git', 'index'));
		entry.fire('change', path.join('/repo', '.git', 'refs', 'heads', 'main'));
		entry.fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['graph']);
	});

	it('holds the refresh until the burst has actually stopped', () => {
		listWatchers[0].fire('change', path.join('/repo', '.git', 'index'));
		vi.advanceTimersByTime(DEBOUNCE_MS - 1);

		expect(listRefreshes).toEqual([]);
	});
});

describe('RepoWatcher.start', () => {
	it('asks for a status pass when the window is focused again', async () => {
		// The third source, after the Git extension and the metadata watcher: it catches what both
		// missed while VS Code sat in the background, e.g. across a sleep.
		await watcher.start();
		vi.useFakeTimers();

		fireWindowState(true);
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual(['status']);
	});

	it('ignores the window losing focus', async () => {
		await watcher.start();
		vi.useFakeTimers();

		fireWindowState(false);
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual([]);
	});

	it('stops listening once disposed', async () => {
		await watcher.start();
		watcher.dispose();
		vi.useFakeTimers();

		fireWindowState(true);
		vi.advanceTimersByTime(DEBOUNCE_MS);

		expect(listRefreshes).toEqual([]);
	});
});
