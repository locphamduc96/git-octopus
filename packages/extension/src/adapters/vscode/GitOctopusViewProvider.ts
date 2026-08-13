import * as vscode from 'vscode';
import type { WebviewToHost } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';

export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	private view?: vscode.WebviewView;

	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly executor: GitExecutor
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri],
		};
		webviewView.webview.html = this.buildHtml(webviewView.webview, mediaUri);

		webviewView.webview.onDidReceiveMessage(async (message: WebviewToHost) => {
			const reply = await routeMessage(message, this.repoContext());
			if (reply) {
				void webviewView.webview.postMessage(reply);
			}
		});
	}

	public async refresh(): Promise<void> {
		if (!this.view) return;
		const reply = await routeMessage({ type: 'loadCommits', limit: 300 }, this.repoContext());
		if (reply) {
			void this.view.webview.postMessage(reply);
		}
	}

	private repoContext(): RepoContext {
		const folder = vscode.workspace.workspaceFolders?.[0];
		return {
			executor: this.executor,
			cwd: folder?.uri.fsPath ?? null,
			repoName: folder?.name ?? null,
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
