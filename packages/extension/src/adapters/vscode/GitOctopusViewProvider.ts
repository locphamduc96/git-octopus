import * as vscode from 'vscode';
import type { GraphFilters, RepoInfo, WebviewToHost } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';
import { findRepos } from '../fs/repoScanner.js';
import type { DiffService } from './DiffService.js';
import type { CommitActionService } from './CommitActionService.js';
import type { WorkingTreeService } from './WorkingTreeService.js';
import type { RepoActionService } from './RepoActionService.js';

const DEFAULT_LIMIT = 300;

export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	private view?: vscode.WebviewView;
	private repos: RepoInfo[] = [];
	private activeRepo: string | null = null;
	private filters: GraphFilters = { branch: null, showRemoteBranches: true };

	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly executor: GitExecutor,
		private readonly diff: DiffService,
		private readonly actions: CommitActionService,
		private readonly workingTree: WorkingTreeService,
		private readonly repoActions: RepoActionService
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri],
		};
		webviewView.webview.html = this.buildHtml(webviewView.webview, mediaUri);

		webviewView.webview.onDidReceiveMessage((message: WebviewToHost) =>
			this.handleMessage(message)
		);
	}

	public async refresh(): Promise<void> {
		await this.send({ type: 'loadCommits', limit: DEFAULT_LIMIT, filters: this.filters });
	}

	private async handleMessage(message: WebviewToHost): Promise<void> {
		const cwd = this.activeRepo;

		switch (message.type) {
			case 'ready':
				await this.discoverRepos();
				await this.send(message);
				return;
			case 'loadCommits':
				if (message.filters) this.filters = message.filters;
				await this.discoverRepos();
				await this.send(message);
				return;
			case 'selectRepo':
				this.activeRepo = message.path;
				this.filters = { branch: null, showRemoteBranches: this.filters.showRemoteBranches };
				await this.refresh();
				return;
			case 'openTerminal':
				if (cwd) {
					vscode.window.createTerminal({ name: 'Git Octopus', cwd }).show();
				}
				return;
			case 'openDiff':
				if (cwd) await this.diff.openDiff(message.hash, message.path, cwd);
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
		if (!this.view) return;
		const reply = await routeMessage(message, this.repoContext(), this.filters);
		if (!reply) return;
		if (reply.type === 'commits') {
			this.onRepoState?.({ repoName: reply.repoName, branch: reply.currentBranch });
		}
		void this.view.webview.postMessage(reply);
	}

	/** Notified whenever the active repository or branch changes (drives the status bar item). */
	public onRepoState?: (state: { repoName: string | null; branch: string | null }) => void;

	/** Re-scan the workspace, keeping the active repository when it still exists. */
	private async discoverRepos(): Promise<void> {
		const listRoots = (vscode.workspace.workspaceFolders ?? []).map(
			(folder) => folder.uri.fsPath
		);
		this.repos = await findRepos(listRoots);
		if (!this.activeRepo || !this.repos.some((repo) => repo.path === this.activeRepo)) {
			this.activeRepo = this.repos[0]?.path ?? null;
		}
	}

	private repoContext(): RepoContext {
		const active = this.repos.find((repo) => repo.path === this.activeRepo) ?? null;
		return {
			executor: this.executor,
			repos: this.repos,
			cwd: active?.path ?? null,
			repoName: active?.name ?? null,
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

function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
