import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RefreshKind } from '../../core/refreshPolicy.js';

export type { RefreshKind };

/** The slice of the built-in Git extension's API this needs. Typed here so nothing is guessed. */
interface GitRepositoryLike {
	rootUri: vscode.Uri;
	state: {
		HEAD?: { commit?: string; name?: string };
		onDidChange: vscode.Event<void>;
	};
}
interface GitApiLike {
	repositories: GitRepositoryLike[];
	onDidOpenRepository: vscode.Event<GitRepositoryLike>;
	onDidCloseRepository?: vscode.Event<GitRepositoryLike>;
}
interface GitExtensionLike {
	getAPI(version: number): GitApiLike;
}

/** Nothing is re-read until this much quiet has passed — a build writes files in bursts. */
const DEBOUNCE_MS = 400;

/** What inside a git dir is worth watching: the refs, the sequencers, and the index. */
const METADATA_GLOB =
	'{HEAD,ORIG_HEAD,MERGE_HEAD,packed-refs,index,refs/**,rebase-merge/**,rebase-apply/**}';

/**
 * Tells the controller when the repository changed underneath it.
 *
 * Three sources, cheapest first. The built-in Git extension already watches every open repository
 * and debounces it, so where it is listening this costs nothing extra. A `.git` metadata watcher
 * covers the repositories it has not opened — and only the metadata: a Cocos project rewrites
 * thousands of files under `library/` on every build, and a watcher over the working tree would
 * spend the day recovering from them. Window focus catches what both may have missed while VS Code
 * was in the background (e.g. during sleep) — a status pass, which the controller upgrades to a
 * graph reload when it sees HEAD moved.
 */
export class RepoWatcher implements vscode.Disposable {
	private listGitApi: vscode.Disposable[] = [];
	/** One state listener per repository the Git extension has open, removed when it closes. */
	private readonly mapRepoListener = new Map<string, vscode.Disposable>();
	private listWatchers: vscode.FileSystemWatcher[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** The heaviest kind asked for since the timer started; `graph` wins over `status`. */
	private pending: RefreshKind | null = null;
	private repoPath: string | null = null;
	/** Last HEAD commit seen per repository, to tell a commit from a file being saved. */
	private readonly mapHead = new Map<string, string>();

	public constructor(private readonly onRefresh: (kind: RefreshKind) => void) {}

	/** Subscribe to the Git extension and to window focus. Safe to call once, at activation. */
	public async start(): Promise<void> {
		this.listGitApi.push(
			vscode.window.onDidChangeWindowState((state) => {
				if (state.focused) this.schedule('status');
			})
		);
		await this.bindGitExtension();
	}

	private async bindGitExtension(): Promise<void> {
		const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
		if (!extension) return;
		try {
			const exported = extension.isActive ? extension.exports : await extension.activate();
			const api = exported.getAPI(1);
			for (const repository of api.repositories) this.bindRepository(repository);
			this.listGitApi.push(
				api.onDidOpenRepository((repository) => this.bindRepository(repository))
			);
			const onClose = api.onDidCloseRepository?.((repository) => {
				const root = repository.rootUri.fsPath;
				this.mapRepoListener.get(root)?.dispose();
				this.mapRepoListener.delete(root);
				this.mapHead.delete(root);
			});
			if (onClose) this.listGitApi.push(onClose);
		} catch {
			// The built-in extension can be disabled outright; the `.git` watcher still covers us.
		}
	}

	private bindRepository(repository: GitRepositoryLike): void {
		const root = repository.rootUri.fsPath;
		this.mapRepoListener.get(root)?.dispose();
		this.mapHead.set(root, repository.state.HEAD?.commit ?? '');
		this.mapRepoListener.set(
			root,
			repository.state.onDidChange(() => {
				const head = repository.state.HEAD?.commit ?? '';
				const moved = this.mapHead.get(root) !== head;
				this.mapHead.set(root, head);
				// Only a moved HEAD means history changed; everything else is the working tree.
				this.schedule(moved ? 'graph' : 'status');
			})
		);
	}

	/** Point the metadata watcher at a repository. Pass null to stop watching. */
	public watch(repoPath: string | null): void {
		if (repoPath === this.repoPath) return;
		this.repoPath = repoPath;
		this.disposeWatchers();
		if (!repoPath) return;
		void this.createWatchers(repoPath);
	}

	private async createWatchers(repoPath: string): Promise<void> {
		const listDirs = await resolveGitDirs(repoPath);
		// The active repository may have changed again while the git dirs were being resolved.
		if (this.repoPath !== repoPath) return;
		for (const dir of listDirs) {
			const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), METADATA_GLOB);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			const onEvent = (uri: vscode.Uri): void => {
				// Git writes and deletes lock files around every operation; they say nothing on their own.
				if (uri.fsPath.endsWith('.lock')) return;
				this.schedule(uri.fsPath.endsWith(`${path.sep}index`) ? 'status' : 'graph');
			};
			watcher.onDidChange(onEvent);
			watcher.onDidCreate(onEvent);
			watcher.onDidDelete(onEvent);
			this.listWatchers.push(watcher);
		}
	}

	private disposeWatchers(): void {
		for (const watcher of this.listWatchers) watcher.dispose();
		this.listWatchers = [];
	}

	private schedule(kind: RefreshKind): void {
		if (this.pending !== 'graph') this.pending = kind;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			const next = this.pending;
			this.pending = null;
			if (next) this.onRefresh(next);
		}, DEBOUNCE_MS);
	}

	public dispose(): void {
		clearTimeout(this.timer);
		this.disposeWatchers();
		for (const listener of this.mapRepoListener.values()) listener.dispose();
		this.mapRepoListener.clear();
		for (const item of this.listGitApi) item.dispose();
		this.listGitApi = [];
	}
}

/**
 * The directories a repository's metadata actually lives in.
 *
 * Usually just `<repo>/.git`, but in a worktree or submodule `.git` is a file pointing at the real
 * git dir — and a worktree's git dir only holds its own HEAD and sequencer state, while the refs
 * live in the shared dir its `commondir` file names. Watching the `.git` path itself in that case
 * would watch nothing: a glob rooted at a file matches no events.
 */
async function resolveGitDirs(repoPath: string): Promise<string[]> {
	const dotGit = path.join(repoPath, '.git');
	const stat = await fs.stat(dotGit).catch(() => null);
	if (!stat) return [];
	if (stat.isDirectory()) return [dotGit];

	const content = await fs.readFile(dotGit, 'utf8').catch(() => '');
	const match = /^gitdir:\s*(.+)$/m.exec(content);
	if (!match) return [];
	const gitDir = path.resolve(repoPath, match[1].trim());

	const common = await fs.readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => null);
	if (common === null) return [gitDir];
	const commonDir = path.resolve(gitDir, common.trim());
	return commonDir === gitDir ? [gitDir] : [gitDir, commonDir];
}
