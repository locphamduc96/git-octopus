import * as vscode from 'vscode';
import { GitOctopusController } from './GitOctopusController.js';

/** Thin adapter registering the controller as the Panel/Side Bar view. */
export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	public constructor(
		private readonly controller: GitOctopusController,
		/** Hands the resolved view out, so the activation code can put a change badge on it. */
		private readonly onView?: (view: vscode.WebviewView) => void
	) {}

	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		await this.controller.attach(webviewView.webview, webviewView.onDidDispose);
		this.onView?.(webviewView);
		// A hidden panel is still an attached webview, so visibility is the only thing that says
		// whether a refresh would be seen by anyone.
		this.controller.setWebviewVisible(webviewView.webview, webviewView.visible);
		webviewView.onDidChangeVisibility(() =>
			this.controller.setWebviewVisible(webviewView.webview, webviewView.visible)
		);
	}
}
