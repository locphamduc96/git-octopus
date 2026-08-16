import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
	GitIdentity,
	GraphFilters,
	HostToWebview,
	RepoInfo,
	WebviewToHost,
} from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	clearLocalIdentity,
	getCurrentBranch,
	getRepoIdentity,
	setLocalIdentity,
} from '../../core/git/gitService.js';
import { getBranchInventory } from '../../core/git/staleBranches.js';
import { BranchCleanupService } from './BranchCleanupService.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';
import { loadStatus } from '../../app/useCases/loadStatus.js';
import { decideRefresh, needsFullReload, type RefreshKind } from '../../core/refreshPolicy.js';
import { findRepos } from '../fs/repoScanner.js';
import type { DiffService } from './DiffService.js';
import type { CommitActionService } from './CommitActionService.js';
import type { WorkingTreeService } from './WorkingTreeService.js';
import type { RepoActionService } from './RepoActionService.js';
import { gravatarUrl } from '../process/gravatar.js';
import { buildForWebview, locateIconTheme, type LocatedIconTheme } from './iconThemeReader.js';

/**
 * Traces what the view asked for and how far the answer got. A hang shows up here as the step it
 * never reached — which is the one thing an empty "Loading…" cannot tell anyone.
 */
const log = vscode.window.createOutputChannel('Git Octopus');
function trace(message: string): void {
	log.appendLine(`${new Date().toISOString().slice(11, 23)} ${message}`);
}

/*
 * Placeholder painted straight into the document, before the bundle is fetched and Svelte mounts —
 * the window between the two is short but it is the one where the panel would otherwise be blank.
 * It stands alone on purpose: `tokens.css` is not loaded yet, so this reads the VS Code theme
 * variables directly, and `main.ts` clears it the moment the real view takes over.
 */
const BOOT_ROW_H = 34;
const BOOT_ROWS = 14;
const BOOT_SKELETON_CSS = `
#boot-skeleton { display: flex; flex-direction: column; height: 100%; overflow: hidden;
	mask-image: linear-gradient(to bottom, #000 55%, transparent 100%); }
#boot-skeleton .boot-bar { flex: none; height: 30px; box-sizing: border-box;
	border-bottom: 1px solid var(--vscode-panel-border); }
#boot-skeleton .boot-row { flex: none; display: flex; align-items: center; gap: 8px;
	height: ${BOOT_ROW_H}px; padding: 0 12px; }
#boot-skeleton .boot-cell { height: 9px; border-radius: 3px;
	background: color-mix(in srgb, var(--vscode-foreground) 13%, transparent); }
#boot-skeleton .boot-ref { width: 70px; height: 14px; border-radius: 4px; }
#boot-skeleton .boot-node { flex: none; width: 8px; height: 8px; border-radius: 50%;
	margin: 0 32px; background: color-mix(in srgb, var(--vscode-foreground) 25%, transparent); }
#boot-skeleton .boot-subject { flex: none; }
#boot-skeleton .boot-date { flex: none; width: 90px; margin-left: auto; }
`;
/** Subject widths, as a share of the row — a column of identical bars does not read as commits. */
const BOOT_SUBJECT_W = [52, 40, 62, 46, 34, 58, 42, 60, 37, 49];
const BOOT_SKELETON_HTML = `<div id="boot-skeleton" aria-hidden="true">
	<div class="boot-bar"></div>
	<div class="boot-bar"></div>
	${Array.from(
		{ length: BOOT_ROWS },
		(_, i) =>
			`<div class="boot-row"><span class="boot-cell boot-ref"></span>` +
			`<span class="boot-node"></span>` +
			`<span class="boot-cell boot-subject" style="width:${BOOT_SUBJECT_W[i % BOOT_SUBJECT_W.length]}%"></span>` +
			`<span class="boot-cell boot-date"></span></div>`
	).join('')}
</div>`;

const DEFAULT_LIMIT = 300;
const STATE_ACTIVE_REPO = 'gitOctopus.activeRepo';
const STATE_FILTERS = 'gitOctopus.filters';
/** Global, and the one key worth syncing across machines — see `setKeysForSync` in extension.ts. */
export const STATE_VIEW_SETTINGS = 'gitOctopus.viewSettings';

/**
 * Owns the repository state and drives every attached webview — the Panel view and any
 * editor-tab panels share one controller, so they stay in sync.
 */
export class GitOctopusController {
	private listWebviews: vscode.Webview[] = [];
	private repos: RepoInfo[] = [];
	private activeRepo: string | null;
	private filters: GraphFilters;
	/** The user's file-icon theme, read once and shared by every webview. */
	private iconTheme: LocatedIconTheme | null = null;
	/** How much history the webview last asked for — auto-refresh must not shrink it. */
	private lastLimit = DEFAULT_LIMIT;
	/** Working-tree state as last reported, so a row appearing or vanishing can be detected. */
	private lastChangeCount = 0;
	/** HEAD as of the last full load, so a status refresh can tell when history moved under it. */
	private lastHeadHash: string | null = null;
	/** Per-webview visibility — the Panel view and any editor tabs each report their own. */
	private readonly mapWebviewVisible = new Map<vscode.Webview, boolean>();
	/** Heaviest refresh skipped while hidden, run when the view is shown again. */
	private missed: RefreshKind | null = null;
	private refreshing = false;
	private queued: RefreshKind | null = null;
	private readonly branchCleanup: BranchCleanupService;

	/** Whether anyone would see a refresh: true while at least one attached webview is on screen. */
	private get visible(): boolean {
		for (const isVisible of this.mapWebviewVisible.values()) {
			if (isVisible) return true;
		}
		return false;
	}

	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly executor: GitExecutor,
		private readonly diff: DiffService,
		private readonly actions: CommitActionService,
		private readonly workingTree: WorkingTreeService,
		private readonly repoActions: RepoActionService,
		private readonly workspaceState: vscode.Memento,
		/** View preferences live here, not in workspace state: they follow the user, not the folder. */
		private readonly globalState: vscode.Memento
	) {
		this.branchCleanup = new BranchCleanupService(executor);
		this.activeRepo = workspaceState.get<string | null>(STATE_ACTIVE_REPO, null);
		this.filters = workspaceState.get<GraphFilters>(STATE_FILTERS, {
			branch: null,
			showRemoteBranches: true,
		});
	}

	private persist(): void {
		void this.workspaceState.update(STATE_ACTIVE_REPO, this.activeRepo);
		void this.workspaceState.update(STATE_FILTERS, this.filters);
	}

	/** Notified whenever the active repository or branch changes (drives the status bar item). */
	public onRepoState?: (state: { repoName: string | null; branch: string | null }) => void;

	/** The repository everything currently acts on — the sidebar tree reads from here. */
	public get activeRepoPath(): string | null {
		return this.activeRepo;
	}

	/** Bring the graph forward and scroll it to a commit (used by the sidebar tree). */
	public async revealCommit(hash: string): Promise<void> {
		await vscode.commands.executeCommand('git-octopus.view.focus');
		const message: HostToWebview = { type: 'revealCommit', hash };
		for (const webview of this.listWebviews) {
			void webview.postMessage(message);
		}
	}

	/** Wire a webview: set its options, render the HTML and start handling its messages. */
	public async attach(webview: vscode.Webview, onDispose: vscode.Event<void>): Promise<void> {
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');
		// The icon theme lives in whichever extension contributes it, so the webview needs reading
		// rights on that folder as well as on our own media. A theme that cannot be read costs the
		// file icons and nothing else — it must never stop the view from being wired up.
		try {
			this.iconTheme ??= await locateIconTheme();
		} catch (error) {
			trace(`icon theme unreadable: ${error instanceof Error ? error.message : String(error)}`);
		}
		webview.options = {
			enableScripts: true,
			localResourceRoots: [mediaUri, ...(this.iconTheme ? [this.iconTheme.root] : [])],
		};
		webview.html = this.buildHtml(webview, mediaUri);

		trace('webview attached');
		this.listWebviews.push(webview);
		// Attached means visible until its container reports otherwise — an editor tab opens on
		// screen, and the Panel view corrects this immediately after resolving.
		this.mapWebviewVisible.set(webview, true);
		webview.onDidReceiveMessage((message: WebviewToHost) => this.handleMessage(message, webview));
		onDispose(() => {
			this.listWebviews = this.listWebviews.filter((item) => item !== webview);
			this.mapWebviewVisible.delete(webview);
		});
	}

	/**
	 * Re-read the icon theme and push it out. Called when the user switches icon theme, and when the
	 * colour theme changes, since a theme can carry a separate set of icons for light backgrounds.
	 */
	public async refreshIconTheme(): Promise<void> {
		this.iconTheme = await locateIconTheme();
		const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');
		for (const webview of this.listWebviews) {
			webview.options = {
				enableScripts: true,
				localResourceRoots: [mediaUri, ...(this.iconTheme ? [this.iconTheme.root] : [])],
			};
			this.sendIconTheme(webview);
			// Rides along because this method already runs on every colour theme change.
			this.sendColorTheme(webview);
		}
	}

	private sendViewSettings(webview: vscode.Webview): void {
		const settings = this.globalState.get<Record<string, unknown>>(STATE_VIEW_SETTINGS) ?? null;
		trace(`→ viewSettings (${settings ? 'stored' : 'nothing stored yet'})`);
		void webview.postMessage({ type: 'viewSettings', settings } satisfies HostToWebview);
	}

	private sendIconTheme(webview: vscode.Webview): void {
		void webview.postMessage({
			type: 'fileIcons',
			theme: this.iconTheme ? buildForWebview(this.iconTheme, webview) : null,
		} satisfies HostToWebview);
	}

	/** Dark or light, for the diff panel's syntax colours. High contrast maps to its base kind. */
	private sendColorTheme(webview: vscode.Webview): void {
		const kind = vscode.window.activeColorTheme.kind;
		const light =
			kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
		void webview.postMessage({
			type: 'colorTheme',
			kind: light ? 'light' : 'dark',
		} satisfies HostToWebview);
	}

	public async refresh(): Promise<void> {
		// The webview grows this by scrolling; reloading at the default would silently drop the
		// history the user has already pulled in.
		await this.send({ type: 'loadCommits', limit: this.lastLimit, filters: this.filters });
	}

	/**
	 * React to the repository changing on disk. Cheap by default: only a moved HEAD reloads the
	 * graph, and nothing runs at all while no webview can see the result.
	 */
	public async autoRefresh(kind: RefreshKind): Promise<void> {
		const decision = decideRefresh(kind, {
			enabled: vscode.workspace.getConfiguration('gitOctopus').get<boolean>('autoRefresh', true),
			hasWebview: this.listWebviews.length > 0,
			visible: this.visible,
			refreshing: this.refreshing,
			missed: this.missed,
			queued: this.queued,
		});
		if (decision.action === 'drop') return;
		if (decision.action === 'defer') {
			this.missed = decision.missed;
			return;
		}
		if (decision.action === 'queue') {
			this.queued = decision.queued;
			return;
		}
		this.refreshing = true;
		try {
			for (let next: RefreshKind | null = decision.kind; next;) {
				if (next === 'graph') await this.refresh();
				else await this.refreshStatus();
				next = this.queued;
				this.queued = null;
			}
		} finally {
			this.refreshing = false;
		}
	}

	/** The working tree only — no history walk, no graph re-layout. */
	private async refreshStatus(): Promise<void> {
		const reply = await loadStatus(this.repoContext());
		if (reply.type !== 'statusUpdate') return;
		const previous = { changeCount: this.lastChangeCount, headHash: this.lastHeadHash };
		this.lastChangeCount = reply.changeCount;
		if (needsFullReload(previous, { changeCount: reply.changeCount, headHash: reply.headHash })) {
			await this.refresh();
			return;
		}
		for (const webview of this.listWebviews) {
			void webview.postMessage(reply);
		}
	}

	/** Told by each container whether its webview is on screen; drives what refreshes are worth. */
	public setWebviewVisible(webview: vscode.Webview, visible: boolean): void {
		this.mapWebviewVisible.set(webview, visible);
		const missed = this.missed;
		if (visible && missed) {
			this.missed = null;
			void this.autoRefresh(missed);
		}
	}

	/**
	 * Nothing here is allowed to fail silently.
	 *
	 * The view asks and then waits: a message that throws on this side leaves it on "Loading…"
	 * forever with no way to tell a slow repository from a dead one. So every failure is turned
	 * into an error the view can draw, and into a notification, rather than a rejected promise
	 * nobody is listening to.
	 */
	private async handleMessage(message: WebviewToHost, webview: vscode.Webview): Promise<void> {
		trace(`← ${message.type}`);
		try {
			await this.routeFromWebview(message, webview);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			trace(`${message.type} FAILED: ${error instanceof Error ? (error.stack ?? detail) : detail}`);
			vscode.window.showErrorMessage(`Git Octopus: ${message.type} failed — ${detail}`);
			void webview.postMessage({
				type: 'error',
				message: `${message.type} failed: ${detail}`,
				repos: this.repos,
				activeRepo: this.activeRepo,
				source: message.type,
			} satisfies HostToWebview);
		}
	}

	private async routeFromWebview(message: WebviewToHost, webview: vscode.Webview): Promise<void> {
		const cwd = this.activeRepo;

		switch (message.type) {
			case 'loadCommits':
				if (message.filters) {
					this.filters = message.filters;
					this.persist();
				}
				this.lastLimit = message.limit;
				// This is also the webview telling us it is listening, so the icons and the saved view
				// settings ride along: a message posted before then would be dropped. Neither is
				// allowed to stand between the view and its commits, hence the guard.
				try {
					this.sendIconTheme(webview);
					this.sendColorTheme(webview);
					this.sendViewSettings(webview);
				} catch (error) {
					trace(
						`sending icons/settings FAILED: ${
							error instanceof Error ? (error.stack ?? error.message) : String(error)
						}`
					);
					vscode.window.showWarningMessage(
						`Git Octopus: could not send the icon theme or saved settings — ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
				trace(`loadCommits(limit=${message.limit}) — scanning for repositories`);
				await this.discoverRepos();
				trace(`found ${this.repos.length} repositories, active = ${this.activeRepo ?? 'none'}`);
				await this.send(message);
				trace('commits reply sent');
				return;
			case 'selectRepo':
				this.activeRepo = message.path;
				this.filters = { ...this.filters, branch: null };
				this.persist();
				await this.refresh();
				await this.sendIdentity();
				return;
			case 'loadIdentity':
				await this.sendIdentity();
				return;
			case 'identityAction':
				if (cwd) {
					try {
						// Persist first: applying triggers a reload, and a save still in flight would be
						// read back as if the new identity had never been added.
						if (message.listIdentities) {
							await vscode.workspace
								.getConfiguration('gitOctopus')
								.update('identities', message.listIdentities, vscode.ConfigurationTarget.Global);
						}
						if (message.action === 'apply' && message.name && message.email) {
							await setLocalIdentity(this.executor, cwd, message.name, message.email);
							vscode.window.showInformationMessage(
								`Git Octopus: this repository now commits as ${message.name} <${message.email}>.`
							);
						} else if (message.action === 'clearOverride') {
							await clearLocalIdentity(this.executor, cwd);
						}
					} catch (error) {
						vscode.window.showErrorMessage(`Git Octopus: ${String(error)}`);
					}
					await this.sendIdentity();
				}
				return;
			case 'saveIdentities':
				await vscode.workspace
					.getConfiguration('gitOctopus')
					.update('identities', message.listIdentities, vscode.ConfigurationTarget.Global);
				await this.sendIdentity();
				return;
			case 'loadBranchInventory':
				await this.sendBranchInventory(webview);
				return;
			case 'cleanupBranches': {
				if (!cwd) return;
				const { listResults, changed } = await this.branchCleanup.run(message, cwd);
				void webview.postMessage({
					type: 'branchCleanupResult',
					listResults,
				} satisfies HostToWebview);
				// The dialog stays open on its result table, so it needs a fresh inventory as much as
				// the graph needs its chips gone.
				if (changed) {
					await this.sendBranchInventory(webview);
					await this.refresh();
				}
				return;
			}
			case 'openTerminal':
				if (cwd) vscode.window.createTerminal({ name: 'Git Octopus', cwd }).show();
				return;
			case 'saveViewSettings':
				// Not awaited: the view is waiting on its own messages behind this one, and a write to
				// extension storage must never be what stands between it and its commits.
				void this.globalState.update(STATE_VIEW_SETTINGS, message.settings);
				// Every other view gets the change too, so two open panels never disagree.
				for (const other of this.listWebviews) {
					if (other !== webview) this.sendViewSettings(other);
				}
				return;
			case 'copyText':
				await vscode.env.clipboard.writeText(message.text);
				vscode.window.showInformationMessage(`Git Octopus: ${message.label} copied.`);
				return;
			case 'openDiff':
				if (cwd) await this.diff.openDiff(message.hash, message.path, cwd, message.oldPath);
				return;
			case 'openCompareDiff':
				if (cwd)
					await this.diff.openCompareDiff(
						message.fromHash,
						message.toHash,
						message.path,
						cwd,
						message.oldPath
					);
				return;
			case 'openWorkingDiff':
				if (cwd) await this.diff.openWorkingDiff(message.path, cwd);
				return;
			case 'openFile':
				if (cwd) await this.diff.openFile(message.path, cwd, message.hash);
				return;
			case 'copyFilePath':
				if (cwd) {
					const text = message.absolute ? path.join(cwd, message.path) : message.path;
					await vscode.env.clipboard.writeText(text);
					vscode.window.showInformationMessage(`Git Octopus: ${text} copied.`);
				}
				return;
			case 'commitAction':
				if (cwd && (await this.actions.run(message, cwd))) await this.refresh();
				return;
			case 'squashCommits':
				if (cwd && (await this.actions.squash(message, cwd))) await this.refresh();
				return;
			case 'multiCommitAction':
				if (cwd && (await this.actions.runMulti(message, cwd))) await this.refresh();
				return;
			case 'sequencerAction':
				if (cwd && (await this.repoActions.runSequencer(message, cwd))) await this.refresh();
				return;
			case 'branchAction':
				if (cwd && (await this.actions.runBranchAction(message, cwd))) await this.refresh();
				return;
			case 'checkFastForward':
				await webview.postMessage({
					type: 'fastForwardCheck',
					nonce: message.nonce,
					canFastForward: cwd
						? await this.actions.canFastForward(message.source, message.target, cwd)
						: false,
				} satisfies HostToWebview);
				return;
			case 'workingTreeAction':
				if (cwd && (await this.workingTree.run(message, cwd))) await this.refresh();
				return;
			case 'repoAction':
				if (cwd && (await this.repoActions.run(message, cwd))) await this.refresh();
				return;
			// Per-view queries: the answer belongs to the panel that asked. Broadcasting it would
			// overwrite the other panels' selection with this one's.
			case 'loadCommitDetails':
			case 'loadComparison':
			case 'loadFileDiff': {
				const reply = await routeMessage(message, this.repoContext(), this.filters);
				if (reply) void webview.postMessage(reply);
				return;
			}
			default:
				await this.send(message);
		}
	}

	/** Read the active repo's identity plus the saved identities, and push them to every webview. */
	/**
	 * "Merged" is measured against the checked-out branch, falling back to HEAD when it is detached:
	 * whatever the user is standing on is what they consider already-integrated work.
	 */
	private async sendBranchInventory(webview: vscode.Webview): Promise<void> {
		const cwd = this.activeRepo;
		if (!cwd) {
			void webview.postMessage({
				type: 'branchInventory',
				listBranches: [],
				mergedBase: null,
			} satisfies HostToWebview);
			return;
		}
		const base = (await getCurrentBranch(this.executor, cwd)) ?? 'HEAD';
		const inventory = await getBranchInventory(this.executor, cwd, base);
		void webview.postMessage({ type: 'branchInventory', ...inventory } satisfies HostToWebview);
	}

	private async sendIdentity(): Promise<void> {
		const cwd = this.activeRepo;
		const identity = cwd
			? await getRepoIdentity(this.executor, cwd)
			: {
					name: null,
					email: null,
					hasLocalName: false,
					hasLocalEmail: false,
					listRemoteUrls: [],
					globalName: null,
					globalEmail: null,
				};
		const listIdentities = vscode.workspace
			.getConfiguration('gitOctopus')
			.get<GitIdentity[]>('identities', []);
		const message: HostToWebview = { type: 'identity', ...identity, listIdentities };
		for (const webview of this.listWebviews) {
			void webview.postMessage(message);
		}
	}

	private async send(message: WebviewToHost): Promise<void> {
		if (this.listWebviews.length === 0) return;
		const reply = await routeMessage(message, this.repoContext(), this.filters);
		if (!reply) return;
		if (reply.type === 'commits') {
			this.lastChangeCount = reply.working
				? reply.working.staged.length + reply.working.unstaged.length
				: 0;
			this.lastHeadHash = reply.headHash;
			this.onRepoState?.({ repoName: reply.repoName, branch: reply.currentBranch });
		}
		for (const webview of this.listWebviews) {
			void webview.postMessage(reply);
		}
	}

	/** Re-scan the workspace, keeping the active repository when it still exists. */
	private async discoverRepos(): Promise<void> {
		const listRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
		this.repos = await findRepos(listRoots);
		if (!this.activeRepo || !this.repos.some((repo) => repo.path === this.activeRepo)) {
			this.activeRepo = this.repos[0]?.path ?? null;
			this.persist();
		}
	}

	private repoContext(): RepoContext {
		const active = this.repos.find((repo) => repo.path === this.activeRepo) ?? null;
		return {
			executor: this.executor,
			repos: this.repos,
			cwd: active?.path ?? null,
			repoName: active?.name ?? null,
			avatarUrl: gravatarUrl,
		};
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
			// The nonce covers the entry script; cspSource is for the grammar chunks it lazily
			// imports — a dynamic import() does not inherit the importer's nonce.
			`script-src ${webview.cspSource} 'nonce-${nonce}'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<style>${BOOT_SKELETON_CSS}</style>
	<title>Git Octopus</title>
</head>
<body>
	<div id="app">${BOOT_SKELETON_HTML}</div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

/** Thin adapter registering the controller as the Panel/Side Bar view. */
export class GitOctopusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'git-octopus.view';

	public constructor(private readonly controller: GitOctopusController) {}

	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		await this.controller.attach(webviewView.webview, webviewView.onDidDispose);
		// A hidden panel is still an attached webview, so visibility is the only thing that says
		// whether a refresh would be seen by anyone.
		this.controller.setWebviewVisible(webviewView.webview, webviewView.visible);
		webviewView.onDidChangeVisibility(() =>
			this.controller.setWebviewVisible(webviewView.webview, webviewView.visible)
		);
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
