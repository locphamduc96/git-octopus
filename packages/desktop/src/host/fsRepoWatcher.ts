import * as fs from 'node:fs';
import * as path from 'node:path';
import { heavier, type RefreshKind } from '@git-octopus/host/core/refreshPolicy';

export const REPO_WATCH_DEBOUNCE_MS = 300;

export interface RepoWatchPaths {
	worktree: string;
	/** `git rev-parse --absolute-git-dir`: the worktree's own git dir (HEAD, index, rebase state). */
	gitDir: string;
	/** `git rev-parse --git-common-dir`, absolute: where refs live. Same as `gitDir` outside a linked worktree. */
	commonDir: string;
}

export interface RepoWatcherDeps {
	watch?: typeof fs.watch;
	debounceMs?: number;
	onError?: (error: Error, watched: string) => void;
}

type GitDirRole = 'own' | 'common';

const listIgnoredSegments = ['.git', 'node_modules'];
const listOwnStatusEntries = ['ORIG_HEAD', 'MERGE_HEAD', 'index', 'rebase-merge', 'rebase-apply'];

function splitPath(relative: string): string[] {
	return relative.split(/[\\/]/).filter((segment) => segment.length > 0);
}

function classifyWorktreePath(relative: string | null): RefreshKind | null {
	if (relative === null) return 'status';
	const listSegments = splitPath(relative);
	return listSegments.some((segment) => listIgnoredSegments.includes(segment)) ? null : 'status';
}

function classifyGitPath(relative: string | null, role: GitDirRole): RefreshKind | null {
	if (relative === null) return 'graph';
	const listSegments = splitPath(relative);
	const first = listSegments[0];
	if (first === undefined || listSegments[listSegments.length - 1].endsWith('.lock')) return null;
	if (first === 'refs' || first === 'packed-refs') return 'graph';
	if (role === 'common') return null;
	if (first === 'HEAD' && listSegments.length === 1) return 'graph';
	return listOwnStatusEntries.includes(first) ? 'status' : null;
}

export class FsRepoWatcher {
	private readonly listWatchers: fs.FSWatcher[] = [];
	private pending: RefreshKind | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;
	private readonly debounceMs: number;

	constructor(
		paths: RepoWatchPaths,
		private readonly onChange: (kind: RefreshKind) => void,
		private readonly deps: RepoWatcherDeps = {},
	) {
		this.debounceMs = deps.debounceMs ?? REPO_WATCH_DEBOUNCE_MS;
		const worktree = path.resolve(paths.worktree);
		const gitDir = path.resolve(paths.gitDir);
		const commonDir = path.resolve(paths.commonDir);
		this.attach(worktree, classifyWorktreePath);
		this.attach(gitDir, (relative) => classifyGitPath(relative, 'own'));
		if (commonDir !== gitDir) this.attach(commonDir, (relative) => classifyGitPath(relative, 'common'));
	}

	close(): void {
		this.closed = true;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
		for (const watcher of this.listWatchers.splice(0)) watcher.close();
	}

	private attach(dir: string, classify: (relative: string | null) => RefreshKind | null): void {
		const watch = this.deps.watch ?? fs.watch;
		try {
			const watcher = watch(dir, { recursive: true }, (_event, filename) => {
				const kind = classify(filename === null || filename === undefined ? null : String(filename));
				if (kind !== null) this.note(kind);
			});
			watcher.on('error', (error) => this.deps.onError?.(error, dir));
			this.listWatchers.push(watcher);
		} catch (error) {
			this.deps.onError?.(error as Error, dir);
		}
	}

	private note(kind: RefreshKind): void {
		if (this.closed) return;
		this.pending = heavier(this.pending, kind);
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
	}

	private flush(): void {
		this.timer = null;
		const kind = this.pending;
		this.pending = null;
		if (kind !== null && !this.closed) this.onChange(kind);
	}
}
