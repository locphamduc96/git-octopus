import * as vscode from 'vscode';
import { GitOctopusViewProvider } from './adapters/vscode/GitOctopusViewProvider.js';
import { GitProcessExecutor } from './adapters/process/gitProcessExecutor.js';
import { DiffService } from './adapters/vscode/DiffService.js';
import { CommitActionService } from './adapters/vscode/CommitActionService.js';

export function activate(context: vscode.ExtensionContext): void {
	const executor = new GitProcessExecutor();
	const diff = new DiffService(executor);
	const actions = new CommitActionService(executor);
	const provider = new GitOctopusViewProvider(context.extensionUri, executor, diff, actions);

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DiffService.scheme, diff),
		vscode.window.registerWebviewViewProvider(GitOctopusViewProvider.viewType, provider),
		vscode.commands.registerCommand('git-octopus.refresh', () => void provider.refresh())
	);
}

export function deactivate(): void {
	// no-op
}
