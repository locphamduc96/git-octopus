import * as vscode from 'vscode';
import type {
	ControllerShell,
	EditorDiff,
	HostShell,
	ViewChannel,
} from '@git-octopus/host/app/ports/shell';
import { nativePrompt } from './nativePrompt.js';
import { buildForWebview, locateIconTheme, type LocatedIconTheme } from './iconThemeReader.js';
import { renderWebviewHtml } from './webviewShell.js';

/**
 * Traces what the view asked for and how far the answer got. A hang shows up here as the step it
 * never reached — which is the one thing an empty "Loading…" cannot tell anyone.
 */
const log = vscode.window.createOutputChannel('Git Octopus');

/** The ports every host service is handed, through the VS Code API. */
export const vscodeHostShell: HostShell = {
	notify: {
		info: (message, ...listActions) =>
			vscode.window.showInformationMessage(message, ...listActions),
		warn: (message, ...listActions) => vscode.window.showWarningMessage(message, ...listActions),
		error: (message, ...listActions) => vscode.window.showErrorMessage(message, ...listActions),
	},
	progress: {
		run: (title, task, options) =>
			Promise.resolve(
				vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title,
						cancellable: options?.cancellable ?? false,
					},
					(progress, token) =>
						task({
							report: (message) => progress.report({ message }),
							get cancelled() {
								return token.isCancellationRequested;
							},
							onCancel: (listener) => void token.onCancellationRequested(listener),
						})
				)
			),
	},
	clipboard: { writeText: (text) => vscode.env.clipboard.writeText(text) },
	open: {
		openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
		openFolderWindow: (folder) =>
			vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), {
				forceNewWindow: true,
			}),
		openTerminal: (cwd) => vscode.window.createTerminal({ name: 'Git Octopus', cwd }).show(),
		openMergeEditor: async (absolutePath) => {
			// The merge editor belongs to VS Code's own Git extension; reusing it beats a three-pane
			// tool of our own.
			try {
				await vscode.commands.executeCommand('git.openMergeEditor', vscode.Uri.file(absolutePath));
			} catch {
				void vscode.window.showErrorMessage(
					"Git Octopus: the merge editor needs VS Code's built-in Git extension to be enabled."
				);
			}
		},
		showMarkdown: async (content) => {
			const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
			await vscode.window.showTextDocument(document, {
				viewColumn: vscode.ViewColumn.Beside,
				preview: false,
			});
		},
	},
	settings: {
		get: <T>(key: string, fallback: T): T =>
			vscode.workspace.getConfiguration('gitOctopus').get<T>(key, fallback),
		// User settings, never the workspace's: an account saved into one folder's settings is
		// invisible everywhere else, which reads to the user as the account having been lost.
		update: (key, value) =>
			vscode.workspace
				.getConfiguration('gitOctopus')
				.update(key, value, vscode.ConfigurationTarget.Global),
	},
	log: { line: (text) => log.appendLine(text) },
};

/** Every view the controller drives here is a webview. */
const asWebview = (view: ViewChannel): vscode.Webview => view as unknown as vscode.Webview;

/** The controller's shell: the services' ports plus the webviews, their theme and their icons. */
export function vscodeControllerShell(
	context: vscode.ExtensionContext,
	editorDiff: EditorDiff
): ControllerShell {
	const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview');
	/** The user's file-icon theme, read once and shared by every webview. */
	let iconTheme: LocatedIconTheme | null = null;
	// The icon theme lives in whichever extension contributes it, so a webview needs reading rights
	// on that folder as well as on our own media.
	const grantResources = (webview: vscode.Webview): void => {
		webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri, ...(iconTheme ? [iconTheme.root] : [])],
		};
	};
	return {
		...vscodeHostShell,
		globalState: context.globalState,
		workspaceState: context.workspaceState,
		editorDiff,
		fallbackPrompt: nativePrompt,
		listRoots: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
		colorThemeKind: () => {
			const kind = vscode.window.activeColorTheme.kind;
			return kind === vscode.ColorThemeKind.Light ||
				kind === vscode.ColorThemeKind.HighContrastLight
				? 'light'
				: 'dark';
		},
		prepareView: async (view) => {
			// A theme that cannot be read costs the file icons and nothing else — it must never stop
			// the view from being wired up.
			try {
				iconTheme ??= await locateIconTheme();
			} catch (error) {
				log.appendLine(
					`icon theme unreadable: ${error instanceof Error ? error.message : String(error)}`
				);
			}
			const webview = asWebview(view);
			grantResources(webview);
			webview.html = renderWebviewHtml(webview, mediaUri);
		},
		fileIconsFor: (view) => (iconTheme ? buildForWebview(iconTheme, asWebview(view)) : null),
		reloadIconTheme: async (listViews) => {
			iconTheme = await locateIconTheme();
			for (const view of listViews) grantResources(asWebview(view));
		},
		// The command, not a view id: the graph may live in an editor tab rather than the Panel.
		focusGraph: () => vscode.commands.executeCommand('git-octopus.focus'),
		// Mod+B means "create branch" only while the graph has focus, and toggles the side bar
		// everywhere else: VS Code's keybindings for the graph are scoped to this context key.
		setGraphFocused: (focused) =>
			void vscode.commands.executeCommand('setContext', 'gitOctopus.graphFocused', focused),
	};
}
