import * as vscode from 'vscode';
import type { CommitActionMessage } from '@git-octopus/shared';
import {
	GitOctopusController,
	GitOctopusViewProvider,
	STATE_VIEW_SETTINGS,
} from './adapters/vscode/GitOctopusViewProvider.js';
import { GitProcessExecutor } from './adapters/process/gitProcessExecutor.js';
import { DiffService } from './adapters/vscode/DiffService.js';
import { CommitActionService } from './adapters/vscode/CommitActionService.js';
import { WorkingTreeService } from './adapters/vscode/WorkingTreeService.js';
import { RepoActionService } from './adapters/vscode/RepoActionService.js';
import { RepoTreeProvider, type RepoNode } from './adapters/vscode/RepoTreeProvider.js';
import { RepoWatcher } from './adapters/vscode/RepoWatcher.js';

export function activate(context: vscode.ExtensionContext): void {
	const executor = new GitProcessExecutor();
	const diff = new DiffService(executor);
	const actions = new CommitActionService(executor);
	const controller = new GitOctopusController(
		context.extensionUri,
		executor,
		diff,
		actions,
		new WorkingTreeService(executor),
		new RepoActionService(executor),
		context.workspaceState,
		context.globalState
	);
	// Preferences follow the user to their other machines; nothing else here is worth syncing.
	context.globalState.setKeysForSync([STATE_VIEW_SETTINGS]);
	const tree = new RepoTreeProvider(executor, () => controller.activeRepoPath);
	const watcher = new RepoWatcher((kind) => void controller.autoRefresh(kind));
	void watcher.start();

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
		// The graph just reloaded, so whatever it changed is what the tree should now show.
		tree.refresh();
		// Cheap when unchanged, and this is the one place that fires on every repository switch.
		watcher.watch(controller.activeRepoPath);
	};

	/** Run a context-menu action from the tree through the same service the graph menus use. */
	const runTreeAction = async (partial: Partial<CommitActionMessage>): Promise<void> => {
		const cwd = controller.activeRepoPath;
		if (!cwd) return;
		const message: CommitActionMessage = {
			type: 'commitAction',
			// Built host-side over the repository it will run on — the stamp is true by construction.
			repoPath: cwd,
			action: 'checkout',
			hash: '',
			subject: '',
			branches: [],
			remoteBranches: [],
			...partial,
		};
		if (await actions.run(message, cwd)) await controller.refresh();
	};

	context.subscriptions.push(
		statusBar,
		watcher,
		vscode.workspace.registerTextDocumentContentProvider(DiffService.scheme, diff),
		vscode.window.registerWebviewViewProvider(
			GitOctopusViewProvider.viewType,
			new GitOctopusViewProvider(controller)
		),
		vscode.window.registerTreeDataProvider('git-octopus.repoTree', tree),
		vscode.commands.registerCommand(
			'git-octopus.revealCommit',
			(hash: string) => void controller.revealCommit(hash)
		),
		vscode.commands.registerCommand('git-octopus.tree.refresh', () => tree.refresh()),
		vscode.commands.registerCommand('git-octopus.tree.checkout', (node: RepoNode) => {
			if (node.kind === 'branch')
				void runTreeAction({ action: 'checkoutBranch', branches: [node.name] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.deleteBranch', (node: RepoNode) => {
			if (node.kind === 'branch')
				void runTreeAction({ action: 'deleteBranch', branches: [node.name] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.checkoutRemote', (node: RepoNode) => {
			if (node.kind === 'remoteBranch')
				void runTreeAction({ action: 'checkoutRemote', remoteBranches: [node.fullName] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.deleteRemoteBranch', (node: RepoNode) => {
			if (node.kind === 'remoteBranch')
				void runTreeAction({ action: 'deleteRemoteBranch', remoteBranches: [node.fullName] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.pushTag', (node: RepoNode) => {
			if (node.kind === 'tag') void runTreeAction({ action: 'pushTag', tags: [node.name] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.deleteTag', (node: RepoNode) => {
			if (node.kind === 'tag') void runTreeAction({ action: 'deleteTag', tags: [node.name] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.deleteRemoteTag', (node: RepoNode) => {
			if (node.kind === 'tag') void runTreeAction({ action: 'deleteRemoteTag', tags: [node.name] });
		}),
		vscode.commands.registerCommand('git-octopus.tree.stashApply', (node: RepoNode) => {
			if (node.kind === 'stash')
				void runTreeAction({ action: 'stashApply', hash: node.hash, stashName: node.name });
		}),
		vscode.commands.registerCommand('git-octopus.tree.stashPop', (node: RepoNode) => {
			if (node.kind === 'stash')
				void runTreeAction({ action: 'stashPop', hash: node.hash, stashName: node.name });
		}),
		vscode.commands.registerCommand('git-octopus.tree.stashDrop', (node: RepoNode) => {
			if (node.kind === 'stash')
				void runTreeAction({ action: 'stashDrop', hash: node.hash, stashName: node.name });
		}),
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
			// The tab reports its own visibility: auto-refresh must keep serving it while the
			// Panel view is hidden or closed.
			panel.onDidChangeViewState(() => controller.setWebviewVisible(panel.webview, panel.visible));
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('workbench.iconTheme')) void controller.refreshIconTheme();
		}),
		// A theme can ship a second set of icons for light backgrounds, and the refresh also
		// resends the colour kind that drives the diff panel's syntax colours.
		vscode.window.onDidChangeActiveColorTheme(() => void controller.refreshIconTheme())
	);
}

export function deactivate(): void {
	// no-op
}
