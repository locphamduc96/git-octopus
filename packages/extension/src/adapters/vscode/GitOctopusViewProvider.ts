import * as vscode from 'vscode';
import type { GraphFilters, HostToWebview, RepoInfo, WebviewToHost } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';
import { findRepos } from '../fs/repoScanner.js';
import type { DiffService } from './DiffService.js';
import type { CommitActionService } from './CommitActionService.js';
import type { WorkingTreeService } from './WorkingTreeService.js';
import type { RepoActionService } from './RepoActionService.js';
import { gravatarUrl } from '../process/gravatar.js';
import { buildForWebview, locateIconTheme, type LocatedIconTheme } from './iconThemeReader.js';

const DEFAULT_LIMIT = 300;
const STATE_ACTIVE_REPO = 'gitOctopus.activeRepo';
const STATE_FILTERS = 'gitOctopus.filters';

/**
 * Owns the repository state and drives every attached webview — the Panel view and any
 * editor-tab panels share one controller, so they stay in sync.
 */
export class GitOctopusController {
	private listWebviews: vscode.Webview[] = [];
	private repos: RepoInfo[] = [];
	private activeRepo: string | null;
	private filters: GraphFilters;
	/** The user's file-icon theme, read once and shared by every webview. */
	private iconTheme: LocatedIconTheme | null = null;

	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly executor: GitExecutor,
		private readonly diff: DiffService,
		private readonly actions: CommitActionService,
		private readonly workingTree: WorkingTreeService,
		private readonly repoActions: RepoActionService,
		private readonly workspaceState: vscode.Memento
	) {
		this.activeRepo = workspaceState.get<string | null>(STATE_ACTIVE_REPO, null);
		this.filters = workspaceState.get<GraphFilters>(STATE_FILTERS, {
			branch: null,
			showRemoteBranches: true,
		});
	}

	private persist(): void {
		void this.workspaceState.update(STATE_ACTIVE_REPO, this.activeRepo);
		void this.workspaceState.update(STATE_FILTERS, this.filters);
	}

	/** Notified whenever the active repository or branch changes (drives the status bar item). */
	public onRepoState?: (state: { repoName: string | null; branch: string | null }) => void;

	/** Wire a webview: set its options, render the HTML and start handling its messages. */
	public async attach(webview: vscode.Webview, onDispose: vscode.Event<void>): Promise<void> {
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');
		// The icon theme lives in whichever extension contributes it, so the webview needs reading
		// rights on that folder as well as on our own media.
		this.iconTheme ??= await locateIconTheme();
		webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri, ...(this.iconTheme ? [this.iconTheme.root] : [])],
		};
		webview.html = this.buildHtml(webview, mediaUri);

		this.listWebviews.push(webview);
		webview.onDidReceiveMessage((message: WebviewToHost) => this.handleMessage(message, webview));
		onDispose(() => {
			this.listWebviews = this.listWebviews.filter((item) => item !== webview);
		});
	}

	/**
	 * Re-read the icon theme and push it out. Called when the user switches icon theme, and when the
	 * colour theme changes, since a theme can carry a separate set of icons for light backgrounds.
	 */
	public async refreshIconTheme(): Promise<void> {
		this.iconTheme = await locateIconTheme();
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');
		for (const webview of this.listWebviews) {
			webview.options = {
				enableScripts: true,
				localResourceRoots: [mediaUri, ...(this.iconTheme ? [this.iconTheme.root] : [])],
			};
			this.sendIconTheme(webview);
		}
	}

	private sendIconTheme(webview: vscode.Webview): void {
		void webview.postMessage({
			type: 'fileIcons',
			theme: this.iconTheme ? buildForWebview(this.iconTheme, webview) : null,
		} satisfies HostToWebview);
	}

	public async refresh(): Promise<void> {
		await this.send({ type: 'loadCommits', limit: DEFAULT_LIMIT, filters: this.filters });
	}

	private async handleMessage(message: WebviewToHost, webview: vscode.Webview): Promise<void> {
		const cwd = this.activeRepo;

		switch (message.type) {
			case 'loadCommits':
				if (message.filters) {
					this.filters = message.filters;
					this.persist();
				}
				// This is also the webview telling us it is listening, so the icons ride along: a
				// message posted before then would be dropped.
				this.sendIconTheme(webview);
				await this.discoverRepos();
				await this.send(message);
				return;
			case 'selectRepo':
				this.activeRepo = message.path;
				this.filters = { ...this.filters, branch: null };
				this.persist();
				await this.refresh();
				return;
			case 'openTerminal':
				if (cwd) vscode.window.createTerminal({ name: 'Git Octopus', cwd }).show();
				return;
			case 'copyText':
				await vscode.env.clipboard.writeText(message.text);
				vscode.window.showInformationMessage(`Git Octopus: ${message.label} copied.`);
				return;
			case 'openDiff':
				if (cwd) await this.diff.openDiff(message.hash, message.path, cwd);
				return;
			case 'openCompareDiff':
				if (cwd)
					await this.diff.openCompareDiff(message.fromHash, message.toHash, message.path, cwd);
				return;
			case 'openWorkingDiff':
				if (cwd) await this.diff.openWorkingDiff(message.path, cwd);
				return;
			case 'commitAction':
				if (cwd && (await this.actions.run(message, cwd))) await this.refresh();
				return;
			case 'workingTreeAction':
				if (cwd && (await this.workingTree.run(message, cwd))) await this.refresh();
				return;
			case 'repoAction':
				if (cwd && (await this.repoActions.run(message, cwd))) await this.refresh();
				return;
			default:
				await this.send(message);
		}
	}

	private async send(message: WebviewToHost): Promise<void> {
		if (this.listWebviews.length === 0) return;
		const reply = await routeMessage(message, this.repoContext(), this.filters);
		if (!reply) return;
		if (reply.type === 'commits') {
			this.onRepoState?.({ repoName: reply.repoName, branch: reply.currentBranch });
		}
		for (const webview of this.listWebviews) {
			void webview.postMessage(reply);
		}
	}

	/** Re-scan the workspace, keeping the active repository when it still exists. */
	private async discoverRepos(): Promise<void> {
		const listRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
		this.repos = await findRepos(listRoots);
		if (!this.activeRepo || !this.repos.some((repo) => repo.path === this.activeRepo)) {
			this.activeRepo = this.repos[0]?.path ?? null;
			this.persist();
		}
	}

	private repoContext(): RepoContext {
		const active = this.repos.find((repo) => repo.path === this.activeRepo) ?? null;
		return {
			executor: this.executor,
			repos: this.repos,
			cwd: active?.path ?? null,
			repoName: active?.name ?? null,
			avatarUrl: gravatarUrl,
		};
	}

	private buildHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'webview.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'webview.css'));
		const nonce = createNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} https: data:`,
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Git Octopus</title>
</head>
<body>
	<div id="app"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

/** Thin adapter registering the controller as the Panel/Side Bar view. */
export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	public constructor(private readonly controller: GitOctopusController) {}

	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		await this.controller.attach(webviewView.webview, webviewView.onDidDispose);
	}
}

function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
