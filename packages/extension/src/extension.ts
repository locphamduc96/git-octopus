import * as vscode from 'vscode';
import { GitOctopusViewProvider } from './adapters/vscode/GitOctopusViewProvider.js';

export function activate(context: vscode.ExtensionContext): void {
	const version = (context.extension.packageJSON as { version: string }).version;
	const provider = new GitOctopusViewProvider(context.extensionUri, version);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(GitOctopusViewProvider.viewType, provider),
		vscode.commands.registerCommand('git-octopus.refresh', () => provider.refresh())
	);
}

export function deactivate(): void {
	// no-op
}
