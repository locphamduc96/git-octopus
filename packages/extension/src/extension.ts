import * as vscode from 'vscode';
import { GitOctopusViewProvider } from './adapters/vscode/GitOctopusViewProvider.js';
import { GitProcessExecutor } from './adapters/process/gitProcessExecutor.js';

export function activate(context: vscode.ExtensionContext): void {
	const provider = new GitOctopusViewProvider(context.extensionUri, new GitProcessExecutor());

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(GitOctopusViewProvider.viewType, provider),
		vscode.commands.registerCommand('git-octopus.refresh', () => void provider.refresh())
	);
}

export function deactivate(): void {
	// no-op
}
