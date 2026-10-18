import * as path from 'node:path';
import type { GitExecutor } from '@git-octopus/host/core/git/GitExecutor';
import type { RefreshKind } from '@git-octopus/host/core/refreshPolicy';
import { FsRepoWatcher, type RepoWatchPaths, type RepoWatcherDeps } from './fsRepoWatcher.js';

/** The three folders a watcher needs for `repo`, which may be a linked worktree. */
export async function resolveWatchPaths(
	executor: GitExecutor,
	repo: string
): Promise<RepoWatchPaths> {
	const out = await executor.run(
		['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
		repo
	);
	const [worktree, gitDir, commonDir] = out.split('\n');
	if (!worktree || !gitDir || !commonDir) {
		throw new Error(`git rev-parse gave no repository folders for ${repo}`);
	}
	return { worktree, gitDir, commonDir: path.resolve(repo, commonDir) };
}

export interface WatcherHandle {
	close(): void;
}

export interface RepoWatchSupervisorDeps {
	resolvePaths: (repo: string) => Promise<RepoWatchPaths>;
	createWatcher: (
		paths: RepoWatchPaths,
		onChange: (kind: RefreshKind) => void,
		deps: RepoWatcherDeps
	) => WatcherHandle;
	onChange: (kind: RefreshKind) => void;
	onError: (error: Error, watched: string) => void;
}

/**
 * Keeps one watcher on the repository the controller is acting on: started when there is one,
 * moved when the user switches, and closed on dispose. Asked again with the same repository it does
 * nothing, so the caller can simply tell it after every state change.
 */
export class RepoWatchSupervisor {
	private wanted: string | null = null;
	private current: WatcherHandle | null = null;
	private generation = 0;
	private closed = false;

	public constructor(private readonly deps: RepoWatchSupervisorDeps) {}

	public get watching(): string | null {
		return this.current ? this.wanted : null;
	}

	public async follow(repo: string | null): Promise<void> {
		if (this.closed || repo === this.wanted) return;
		const generation = ++this.generation;
		this.wanted = repo;
		this.stop();
		if (repo === null) return;
		try {
			const paths = await this.deps.resolvePaths(repo);
			if (generation !== this.generation || this.closed) return;
			this.current = this.deps.createWatcher(paths, this.deps.onChange, {
				onError: this.deps.onError,
			});
		} catch (error) {
			// Asked again next time: a git that could not run a moment ago may run now.
			if (generation === this.generation) this.wanted = null;
			this.deps.onError(error instanceof Error ? error : new Error(String(error)), repo);
		}
	}

	public close(): void {
		this.closed = true;
		this.generation++;
		this.wanted = null;
		this.stop();
	}

	private stop(): void {
		this.current?.close();
		this.current = null;
	}
}

/** The supervisor wired to the real watcher. */
export function createRepoWatchSupervisor(
	deps: Pick<RepoWatchSupervisorDeps, 'onChange' | 'onError'> & { executor: GitExecutor }
): RepoWatchSupervisor {
	return new RepoWatchSupervisor({
		resolvePaths: (repo) => resolveWatchPaths(deps.executor, repo),
		createWatcher: (paths, onChange, watcherDeps) =>
			new FsRepoWatcher(paths, onChange, watcherDeps),
		onChange: deps.onChange,
		onError: deps.onError,
	});
}
