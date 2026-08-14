import * as vscode from 'vscode';
import {
	GitOctopusController,
	GitOctopusViewProvider,
} from './adapters/vscode/GitOctopusViewProvider.js';
import { GitProcessExecutor } from './adapters/process/gitProcessExecutor.js';
import { DiffService } from './adapters/vscode/DiffService.js';
import { CommitActionService } from './adapters/vscode/CommitActionService.js';
import { WorkingTreeService } from './adapters/vscode/WorkingTreeService.js';
import { RepoActionService } from './adapters/vscode/RepoActionService.js';

export function activate(context: vscode.ExtensionContext): void {
	const executor = new GitProcessExecutor();
	const diff = new DiffService(executor);
	const controller = new GitOctopusController(
		context.extensionUri,
		executor,
		diff,
		new CommitActionService(executor),
		new WorkingTreeService(executor),
		new RepoActionService(executor),
		context.workspaceState
	);

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'git-octopus.focus';
	statusBar.tooltip = 'Open Git Octopus';
	controller.onRepoState = ({ repoName, branch }) => {
		if (!repoName) {
			statusBar.hide();
			return;
		}
		statusBar.text = `$(git-branch) ${branch ?? repoName}`;
		statusBar.show();
	};

	context.subscriptions.push(
		statusBar,
		vscode.workspace.registerTextDocumentContentProvider(DiffService.scheme, diff),
		vscode.window.registerWebviewViewProvider(
			GitOctopusViewProvider.viewType,
			new GitOctopusViewProvider(controller)
		),
		vscode.commands.registerCommand('git-octopus.refresh', () => void controller.refresh()),
		vscode.commands.registerCommand(
			'git-octopus.focus',
			() => void vscode.commands.executeCommand('git-octopus.view.focus')
		),
		vscode.commands.registerCommand('git-octopus.openInTab', () => {
			const panel = vscode.window.createWebviewPanel(
				'git-octopus.tab',
				'Git Octopus',
				vscode.ViewColumn.Active,
				{ enableScripts: true, retainContextWhenHidden: true }
			);
			void controller.attach(panel.webview, panel.onDidDispose);
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('workbench.iconTheme')) void controller.refreshIconTheme();
		}),
		// A theme can ship a second set of icons for light backgrounds.
		vscode.window.onDidChangeActiveColorTheme(() => void controller.refreshIconTheme())
	);
}

export function deactivate(): void {
	// no-op
}
