import * as vscode from 'vscode';
import type { GitOctopusController } from './GitOctopusController.js';

/** Where "Open Git Octopus" shows the graph — the values of the `gitOctopus.defaultLocation` setting. */
export type GraphLocation = 'panel' | 'editor';

/**
 * An editor tab that is already open always wins: the Panel view would show the same repository a
 * second time. Anything but an explicit `editor` means the Panel, where the graph has always lived.
 */
export function pickGraphLocation(tabOpen: boolean, defaultLocation: unknown): GraphLocation {
	if (tabOpen) return 'editor';
	return defaultLocation === 'editor' ? 'editor' : 'panel';
}

type TabHost = Pick<GitOctopusController, 'attach' | 'setWebviewVisible'>;

/**
 * The graph as an editor tab — never more than one. Every tab would show the single repository the
 * controller holds, so a second one is only a copy; opening again brings the existing tab forward.
 * Also the serializer that brings the tab back after a window reload.
 */
export class GitOctopusTab implements vscode.WebviewPanelSerializer {
	public static readonly viewType = 'git-octopus.tab';

	private panel: vscode.WebviewPanel | undefined;

	public constructor(
		private readonly controller: TabHost,
		private readonly extensionUri: vscode.Uri
	) {}

	public get isOpen(): boolean {
		return this.panel !== undefined;
	}

	public async open(): Promise<void> {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			GitOctopusTab.viewType,
			'Git Octopus',
			vscode.ViewColumn.Active,
			// Same reason as the Panel view: the tab holds live UI state (an open AI-commit plan,
			// scroll depth) that an agent run in flight may still answer into.
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		await this.adopt(panel);
	}

	public close(): void {
		this.panel?.dispose();
	}

	public async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
		// A restored layout should hold one tab at most; a second would stay blank, so it closes.
		if (this.panel) {
			panel.dispose();
			return;
		}
		await this.adopt(panel);
	}

	private async adopt(panel: vscode.WebviewPanel): Promise<void> {
		this.panel = panel;
		panel.iconPath = {
			light: vscode.Uri.joinPath(this.extensionUri, 'media', 'octopus-light.svg'),
			dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'octopus-dark.svg'),
		};
		panel.onDidDispose(() => {
			if (this.panel === panel) this.panel = undefined;
		});
		await this.controller.attach(panel.webview, panel.onDidDispose);
		// A restored tab can come back behind another one, so it reports where it really is.
		this.controller.setWebviewVisible(panel.webview, panel.visible);
		panel.onDidChangeViewState(() =>
			this.controller.setWebviewVisible(panel.webview, panel.visible)
		);
	}
}
