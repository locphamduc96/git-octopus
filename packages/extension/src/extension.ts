import * as vscode from 'vscode';
import type { CommitActionMessage } from '@git-octopus/shared';
import {
	GitOctopusController,
	STATE_VIEW_SETTINGS,
} from './adapters/vscode/GitOctopusController.js';
import { GitOctopusViewProvider } from './adapters/vscode/GitOctopusViewProvider.js';
import { GitOctopusTab, pickGraphLocation } from './adapters/vscode/GitOctopusTab.js';
import { GitProcessExecutor } from './adapters/process/gitProcessExecutor.js';
import { SerializingGitExecutor } from './adapters/process/serializingGitExecutor.js';
import { LockRetryGitExecutor } from './adapters/process/lockRetryGitExecutor.js';
import { DiffService } from './adapters/vscode/DiffService.js';
import {
	CommitActionService,
	readHostViewSettings,
} from './adapters/vscode/CommitActionService.js';
import { WorkingTreeService } from './adapters/vscode/WorkingTreeService.js';
import { RepoActionService } from './adapters/vscode/RepoActionService.js';
import { CommitAgentService } from './adapters/vscode/CommitAgentService.js';
import { RepoTreeProvider, type RepoNode } from './adapters/vscode/RepoTreeProvider.js';
import { RepoWatcher } from './adapters/vscode/RepoWatcher.js';
import { AutoFetchScheduler } from './adapters/vscode/AutoFetchScheduler.js';
import { pickAutoFetchMinutes } from '@git-octopus/shared';
import { AskpassServer } from './adapters/askpass/askpassServer.js';
import { nativePrompt } from './adapters/vscode/nativePrompt.js';
import { pathExists } from './adapters/fs/pathExists.js';

/**
 * The askpass bridge, or undefined when it must stay out of the way: on Windows (not supported
 * in v1), when the user already runs their own askpass (delegate, never override), or when
 * setup fails — in which case the extension degrades to the fail-fast behaviour it had before.
 */
async function startAskpass(context: vscode.ExtensionContext): Promise<AskpassServer | undefined> {
	if (process.platform === 'win32') return undefined;
	if (process.env.GIT_ASKPASS || process.env.SSH_ASKPASS) return undefined;
	try {
		const askpass = new AskpassServer(context.extensionUri.fsPath);
		await askpass.start();
		context.subscriptions.push(askpass);
		return askpass;
	} catch {
		return undefined;
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Awaited before the executor exists: a git command must never race the socket into being.
	const askpass = await startAskpass(context);
	// Wrapped once, here: this is the only place a git executor is constructed in production, and
	// every service below shares the instance — so the queue covers every git command we run. The
	// lock retry sits inside the queue, so a write waiting out another process keeps its turn.
	const executor = new SerializingGitExecutor(
		new LockRetryGitExecutor(new GitProcessExecutor(askpass))
	);
	const diff = new DiffService(executor);
	// The stored blob is everything the view persists — settings, columns, panel state. Only the
	// settings half is a preference the host acts on, so only that half is handed over.
	const actions = new CommitActionService(executor, () =>
		readHostViewSettings(context.globalState.get<unknown>(STATE_VIEW_SETTINGS))
	);
	const controller = new GitOctopusController(
		context.extensionUri,
		executor,
		diff,
		actions,
		new WorkingTreeService(executor),
		new RepoActionService(executor),
		new CommitAgentService(
			executor,
			context.globalState,
			undefined,
			vscode.Uri.joinPath(context.globalStorageUri, 'agent-workdir').fsPath
		),
		context.workspaceState,
		context.globalState
	);
	// Preferences follow the user to their other machines; nothing else here is worth syncing.
	context.globalState.setKeysForSync([STATE_VIEW_SETTINGS]);
	const tree = new RepoTreeProvider(executor, () => controller.activeRepoPath);
	const watcher = new RepoWatcher((kind) => void controller.autoRefresh(kind));
	void watcher.start();

	// Fetch on a schedule so the drift drawn on branch chips describes the repository as it is.
	// On by default, every minute (`DEFAULT_AUTO_FETCH_MINUTES`), until the user picks another
	// interval or 0; it gives up with one warning after repeated failures.
	const autoFetch = new AutoFetchScheduler({
		executor,
		activeRepo: () => controller.activeRepoPath,
		intervalMinutes: () =>
			pickAutoFetchMinutes(
				readHostViewSettings(context.globalState.get<unknown>(STATE_VIEW_SETTINGS))
					?.autoFetchMinutes
			),
		focused: () => vscode.window.state.focused,
		now: () => Date.now(),
		pathExists,
		onFetched: () => void controller.autoRefresh('graph'),
		onGaveUp: (message) =>
			vscode.window.showWarningMessage(
				`Git Octopus: auto-fetch stopped after repeated failures — ${message}`
			),
	});
	autoFetch.start();
	context.subscriptions.push({ dispose: () => autoFetch.dispose() });

	// The same red badge Source Control wears: working-tree change count, on the panel view's
	// title and as a count on the status bar item — the only two places left to show it now that
	// Git Octopus contributes no activity-bar icon.
	let lastBadgeCount = 0;
	let listBadgeViews: vscode.WebviewView[] = [];
	const applyBadge = (view: vscode.WebviewView): void => {
		view.badge =
			lastBadgeCount > 0
				? {
						value: lastBadgeCount,
						tooltip: `${lastBadgeCount} file${lastBadgeCount === 1 ? '' : 's'} changed`,
					}
				: undefined;
	};
	const trackBadgeView = (view: vscode.WebviewView): void => {
		listBadgeViews.push(view);
		applyBadge(view);
		view.onDidDispose(() => {
			listBadgeViews = listBadgeViews.filter((item) => item !== view);
		});
	};

	const tab = new GitOctopusTab(controller, context.extensionUri);
	const focusPanelView = (): Thenable<unknown> =>
		vscode.commands.executeCommand(`${GitOctopusViewProvider.viewType}.focus`);
	/** Bring the graph forward wherever it belongs — see `pickGraphLocation`. */
	const showGraph = async (): Promise<void> => {
		const location = pickGraphLocation(
			tab.isOpen,
			vscode.workspace.getConfiguration('gitOctopus').get('defaultLocation')
		);
		if (location === 'editor') await tab.open();
		else await focusPanelView();
	};

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'git-octopus.focus';
	/** Branch name when there is one, else the repository's; null while no repository is open. */
	let statusLabel: string | null = null;
	const renderStatusBar = (): void => {
		if (statusLabel === null) {
			statusBar.hide();
			return;
		}
		const changed = `${lastBadgeCount} file${lastBadgeCount === 1 ? '' : 's'} changed`;
		statusBar.text =
			lastBadgeCount > 0
				? `$(git-branch) ${statusLabel} ●${lastBadgeCount}`
				: `$(git-branch) ${statusLabel}`;
		statusBar.tooltip = lastBadgeCount > 0 ? `${changed} — open Git Octopus` : 'Open Git Octopus';
		statusBar.show();
	};

	controller.onChangeCount = (count) => {
		if (count === lastBadgeCount) return;
		lastBadgeCount = count;
		for (const view of listBadgeViews) applyBadge(view);
		renderStatusBar();
	};

	// The badge must not wait for a view to open — prime it now, and start watching the
	// repository it found so later edits keep it honest.
	void controller.primeChangeCount().then(() => watcher.watch(controller.activeRepoPath));

	controller.onRepoState = ({ repoName, branch }) => {
		if (!repoName) {
			statusLabel = null;
			renderStatusBar();
			return;
		}
		statusLabel = branch ?? repoName;
		renderStatusBar();
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
		if (await actions.run(message, cwd, nativePrompt)) await controller.refresh();
	};

	context.subscriptions.push(
		statusBar,
		watcher,
		vscode.workspace.registerTextDocumentContentProvider(DiffService.scheme, diff),
		vscode.window.registerWebviewViewProvider(
			GitOctopusViewProvider.viewType,
			new GitOctopusViewProvider(controller, trackBadgeView),
			// Keep the webview alive while another panel tab covers it: the view holds live UI
			// state (an open AI-commit plan, scroll depth), and an agent run in flight would
			// otherwise post its result to a webview that no longer exists.
			{ webviewOptions: { retainContextWhenHidden: true } }
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
				void runTreeAction({
					action: 'checkoutRemote',
					remoteBranches: [{ remote: node.remote, branch: node.branch }],
				});
		}),
		vscode.commands.registerCommand('git-octopus.tree.deleteRemoteBranch', (node: RepoNode) => {
			if (node.kind === 'remoteBranch')
				void runTreeAction({
					action: 'deleteRemoteBranch',
					remoteBranches: [{ remote: node.remote, branch: node.branch }],
				});
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
		vscode.commands.registerCommand('git-octopus.focus', showGraph),
		vscode.commands.registerCommand('git-octopus.openInTab', () => tab.open()),
		vscode.commands.registerCommand('git-octopus.moveToEditor', async () => {
			const panelShowsGraph = listBadgeViews.some((view) => view.visible);
			await tab.open();
			// Closing the Panel area only hides it — a terminal the user had there is one toggle
			// away. Left alone when the Panel was showing something else, or nothing.
			if (panelShowsGraph) await vscode.commands.executeCommand('workbench.action.closePanel');
		}),
		vscode.commands.registerCommand('git-octopus.moveToPanel', async () => {
			tab.close();
			await focusPanelView();
		}),
		vscode.window.registerWebviewPanelSerializer(GitOctopusTab.viewType, tab),
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
