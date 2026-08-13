import * as vscode from 'vscode';
import type { WebviewToHost } from '@git-octopus/shared';
import { routeMessage } from '../../app/messageRouter.js';

export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	private view?: vscode.WebviewView;

	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly version: string
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri],
		};

		webviewView.webview.html = this.buildHtml(webviewView.webview, mediaUri);

		webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
			const reply = routeMessage(message, { version: this.version });
			if (reply) {
				void webviewView.webview.postMessage(reply);
			}
		});
	}

	public refresh(): void {
		if (this.view) {
			this.view.webview.postMessage({ type: 'pong', nonce: -1, version: this.version });
		}
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
