import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	GitIdentity,
	GraphFilters,
	HostToWebview,
	RepoInfo,
	WebviewToHost,
	WorkspaceIdentityEntry,
} from '@git-octopus/shared';
import { assertNever } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	clearLocalIdentity,
	getCurrentBranch,
	getRepoIdentity,
	setLocalIdentity,
} from '../../core/git/gitService.js';
import { getBranchInventory } from '../../core/git/staleBranches.js';
import { readCommitTemplate } from '../fs/commitTemplate.js';
import { getRemotes } from '../../core/git/remotes.js';
import { getSigningConfig, setSigningConfig } from '../../core/git/signing.js';
import { getRefPanelData } from '../../core/git/refInventory.js';
import { getWorktrees } from '../../core/git/worktrees.js';
import { WorktreeService } from './WorktreeService.js';
import { InteractiveRebaseService } from './InteractiveRebaseService.js';
import { HistoryRewriter } from './HistoryRewriter.js';
import { BranchCleanupService } from './BranchCleanupService.js';
import { UndoService } from './UndoService.js';
import {
	branchActionLabel,
	commitActionLabel,
	multiActionLabel,
	squashLabel,
} from '../../core/git/undoLabel.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';
import { loadStatus } from '../../app/useCases/loadStatus.js';
import { decideRefresh, needsFullReload, type RefreshKind } from '../../core/refreshPolicy.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import type { ControllerShell, ViewChannel } from '../../app/ports/shell.js';
import { WebviewPromptBroker } from './webviewPrompt.js';
import { findRepos, withSubmodules } from '../fs/repoScanner.js';
import { getSubmodulePaths } from '../../core/git/submodules.js';
import { pathExists } from '../fs/pathExists.js';
import { readBlob } from '../process/blobReader.js';
import type { CommitActionService } from './CommitActionService.js';
import type { WorkingTreeService } from './WorkingTreeService.js';
import type { RepoActionService } from './RepoActionService.js';
import type { CommitAgentService } from './CommitAgentService.js';
import { gravatarUrl } from '../process/gravatar.js';

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
	private listWebviews: ViewChannel[] = [];
	/** The views that have keyboard focus — at most one in practice, kept as a set for safety. */
	private setFocused = new Set<ViewChannel>();
	private repos: RepoInfo[] = [];
	private activeRepo: string | null;
	private filters: GraphFilters;
	/** How much history the webview last asked for — auto-refresh must not shrink it. */
	private lastLimit = DEFAULT_LIMIT;
	/**
	 * What each attached view asked for. One view scrolling deep into history must not be cut
	 * back to another view's page size when that one loads — every shared answer covers the
	 * deepest request still on screen.
	 */
	private readonly mapWebviewLimit = new Map<ViewChannel, number>();
	/** Views that asked for the side panel's refs — only these pay for the extra git call on a reload. */
	private readonly setRefPanelViews = new Set<ViewChannel>();
	/** Orders overlapping ref-panel reads: only the one holding the latest ticket may post. */
	private refPanelSeq = 0;
	/** Working-tree state as last reported, so a row appearing or vanishing can be detected. */
	private lastChangeCount = 0;
	/**
	 * Orders the concurrent status reads. An action's refresh and the watcher's probes run in
	 * parallel, and a snapshot taken before a commit can resolve after the one taken behind it —
	 * writing yesterday's count over the badge. Each read takes a ticket before awaiting and only
	 * applies if no newer read has started since.
	 */
	private statusSeq = 0;
	/** HEAD as of the last full load, so a status refresh can tell when history moved under it. */
	private lastHeadHash: string | null = null;
	/** Per-webview visibility — the Panel view and any editor tabs each report their own. */
	private readonly mapWebviewVisible = new Map<ViewChannel, boolean>();
	/** One prompt broker per attached webview — questions go back to the view that acted. */
	private readonly mapWebviewPrompt = new Map<ViewChannel, WebviewPromptBroker>();
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

	/** Remembers what the last repository-changing action did, so it can be put back. */
	private readonly undo: UndoService;
	private readonly interactiveRebase: InteractiveRebaseService;
	private readonly worktrees: WorktreeService;

	public constructor(
		/** View preferences live in its global state, not the workspace's: they follow the user. */
		private readonly shell: ControllerShell,
		private readonly executor: GitExecutor,
		private readonly actions: CommitActionService,
		private readonly workingTree: WorkingTreeService,
		private readonly repoActions: RepoActionService,
		private readonly commitAgent: CommitAgentService
	) {
		this.branchCleanup = new BranchCleanupService(executor, shell);
		this.undo = new UndoService(executor, shell);
		this.interactiveRebase = new InteractiveRebaseService(
			executor,
			shell,
			new HistoryRewriter(executor, shell)
		);
		this.worktrees = new WorktreeService(executor, shell);
		this.activeRepo = shell.workspaceState.get<string | null>(STATE_ACTIVE_REPO, null);
		this.filters = shell.workspaceState.get<GraphFilters>(STATE_FILTERS, {
			branch: null,
			showRemoteBranches: true,
		});
	}

	/**
	 * Traces what the view asked for and how far the answer got. A hang shows up here as the step it
	 * never reached — which is the one thing an empty "Loading…" cannot tell anyone.
	 */
	private trace(message: string): void {
		this.shell.log.line(`${new Date().toISOString().slice(11, 23)} ${message}`);
	}

	private persist(): void {
		void this.shell.workspaceState.update(STATE_ACTIVE_REPO, this.activeRepo);
		void this.shell.workspaceState.update(STATE_FILTERS, this.filters);
	}

	/** Notified whenever the active repository or branch changes (drives the status bar item). */
	public onRepoState?: (state: { repoName: string | null; branch: string | null }) => void;

	/** Notified with the working-tree change count (drives the view badges, like SCM's). */
	public onChangeCount?: (count: number) => void;

	/** The repository everything currently acts on — the sidebar tree reads from here. */
	public async selectRepo(repoPath: string): Promise<void> {
		// Only a repository this controller discovered may become active: everything else runs
		// `git` with this value as its working directory.
		if (!this.repos.some((repo) => repo.path === repoPath)) return;
		this.activeRepo = repoPath;
		this.filters = { ...this.filters, branch: null };
		this.persist();
		await this.refresh();
		await this.sendIdentity();
	}

	/** Switch to a submodule of the active repository, named by its path inside it. */
	public async openSubmodule(subPath: string): Promise<void> {
		const target = this.repos.find(
			(repo) => repo.parent === this.activeRepo && repo.subPath === subPath
		);
		if (target) {
			await this.selectRepo(target.path);
			return;
		}
		this.shell.notify.warn(
			`Git Octopus: ${subPath} is not checked out — run “git submodule update --init ${subPath}” first.`
		);
	}

	public get activeRepoPath(): string | null {
		return this.activeRepo;
	}

	/** Bring the graph forward and scroll it to a commit (used by the sidebar tree). */
	public async revealCommit(hash: string): Promise<void> {
		await this.shell.focusGraph();
		this.broadcast({ type: 'revealCommit', hash });
	}

	/** Wire a view: let the shell ready it, then start handling its messages. */
	public async attach(
		webview: ViewChannel,
		onDispose: (listener: () => void) => unknown
	): Promise<void> {
		await this.shell.prepareView(webview);
		this.trace('webview attached');
		this.listWebviews.push(webview);
		this.mapWebviewPrompt.set(
			webview,
			new WebviewPromptBroker((message) => void webview.postMessage(message))
		);
		// Attached means visible until its container reports otherwise — an editor tab opens on
		// screen, and the Panel view corrects this immediately after resolving.
		this.mapWebviewVisible.set(webview, true);
		webview.onDidReceiveMessage((message: WebviewToHost) => this.handleMessage(message, webview));
		onDispose(() => {
			this.listWebviews = this.listWebviews.filter((item) => item !== webview);
			this.mapWebviewVisible.delete(webview);
			this.mapWebviewLimit.delete(webview);
			this.setRefPanelViews.delete(webview);
			this.mapWebviewPrompt.get(webview)?.cancelAll();
			this.mapWebviewPrompt.delete(webview);
			this.setViewFocus(webview, false);
		});
	}

	/**
	 * Track which view has focus and tell VS Code, whose keybindings for the graph are scoped to the
	 * `gitOctopus.graphFocused` context: Mod+B means "create branch" only while the graph has focus,
	 * and toggles the side bar everywhere else.
	 */
	private setViewFocus(webview: ViewChannel, focused: boolean): void {
		const before = this.setFocused.size > 0;
		if (focused) this.setFocused.add(webview);
		else this.setFocused.delete(webview);
		const after = this.setFocused.size > 0;
		if (before !== after) {
			this.shell.setGraphFocused(after);
		}
	}

	/** A graph keybinding fired: the focused view acts on it, with its own selection. */
	public sendHostCommand(command: 'createBranch' | 'fetch'): void {
		for (const webview of this.setFocused) {
			void webview.postMessage({ type: 'hostCommand', command } satisfies HostToWebview);
		}
	}

	/**
	 * Re-read the icon theme and push it out. Called when the user switches icon theme, and when the
	 * colour theme changes, since a theme can carry a separate set of icons for light backgrounds.
	 */
	public async refreshIconTheme(): Promise<void> {
		await this.shell.reloadIconTheme(this.listWebviews);
		for (const webview of this.listWebviews) {
			this.sendIconTheme(webview);
			// Rides along because this method already runs on every colour theme change.
			this.sendColorTheme(webview);
		}
	}

	/** The editor's tab size changed: every view redraws its diffs with the new width. */
	public refreshEditorPrefs(): void {
		for (const webview of this.listWebviews) this.sendEditorPrefs(webview);
	}

	private sendEditorPrefs(webview: ViewChannel): void {
		this.reply(webview, {
			type: 'editorPrefs',
			tabSize: this.shell.editorTabSize(),
		} satisfies HostToWebview);
	}

	private sendViewSettings(webview: ViewChannel): void {
		const settings =
			this.shell.globalState.get<Record<string, unknown>>(STATE_VIEW_SETTINGS) ?? null;
		this.trace(`→ viewSettings (${settings ? 'stored' : 'nothing stored yet'})`);
		this.reply(webview, { type: 'viewSettings', settings } satisfies HostToWebview);
	}

	private sendIconTheme(webview: ViewChannel): void {
		this.reply(webview, {
			type: 'fileIcons',
			theme: this.shell.fileIconsFor(webview),
		} satisfies HostToWebview);
	}

	/** Dark or light, for the diff panel's syntax colours. High contrast maps to its base kind. */
	private sendColorTheme(webview: ViewChannel): void {
		this.reply(webview, {
			type: 'colorTheme',
			kind: this.shell.colorThemeKind(),
		} satisfies HostToWebview);
	}

	/** The deepest history any attached view is standing in — what every shared answer must cover. */
	private get broadcastLimit(): number {
		let limit = 0;
		for (const value of this.mapWebviewLimit.values()) limit = Math.max(limit, value);
		return limit || this.lastLimit;
	}

	public async refresh(): Promise<void> {
		// The webview grows this by scrolling; reloading at the default would silently drop the
		// history the user has already pulled in.
		await this.send({ type: 'loadCommits', limit: this.broadcastLimit, filters: this.filters });
		this.sendUndoState();
	}

	/**
	 * Read the side panel's refs once and post them to every view that asked. Runs whenever the
	 * graph is reloaded (see `send`) and when a view first asks. Never fails: a panel that cannot
	 * refresh must not break the reload. Reads overlap, so each takes a ticket and only the newest
	 * posts — an older snapshot finishing late must not replace a newer one.
	 */
	private async sendRefPanel(): Promise<void> {
		const cwd = this.activeRepo;
		if (this.setRefPanelViews.size === 0 || !cwd) return;
		const ticket = ++this.refPanelSeq;
		try {
			const data = await getRefPanelData(this.executor, cwd);
			if (ticket !== this.refPanelSeq || !this.stillCurrent(cwd)) return;
			for (const target of this.setRefPanelViews) {
				this.reply(target, { type: 'refPanel', repoPath: cwd, data });
			}
		} catch (error) {
			this.trace(
				`ref panel read failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Tell every view what Undo would now undo.
	 *
	 * Sent from `refresh` rather than from each action: every path that changes the repository ends
	 * up here, so a button that offered a stale promise would have to get past this on the way.
	 */
	private sendUndoState(): void {
		this.broadcast({
			type: 'undoState',
			label: this.undo.labelFor(this.activeRepo),
			redoLabel: this.undo.redoLabelFor(this.activeRepo),
		});
	}

	/**
	 * React to the repository changing on disk. Cheap by default: only a moved HEAD reloads the
	 * graph, and nothing runs at all while no webview can see the result.
	 */
	public async autoRefresh(kind: RefreshKind): Promise<void> {
		const enabled = this.shell.settings.get<boolean>('autoRefresh', true);
		const decision = decideRefresh(kind, {
			enabled,
			hasWebview: this.listWebviews.length > 0,
			visible: this.visible,
			refreshing: this.refreshing,
			missed: this.missed,
			queued: this.queued,
		});
		if (decision.action === 'drop') {
			// The graph can wait for a viewer; the badge cannot — SCM's count stays live with
			// every view closed, so ours does too. A user who turned auto-refresh off is left alone.
			if (enabled) void this.probeChangeCount();
			return;
		}
		if (decision.action === 'defer') {
			this.missed = decision.missed;
			void this.probeChangeCount();
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

	/**
	 * First badge value of the session, run on activation: the count must show on the activity
	 * bar the way Source Control's does, before any of our views has ever been opened.
	 */
	public async primeChangeCount(): Promise<void> {
		await this.discoverRepos();
		await this.probeChangeCount();
	}

	/** Refresh only the badge count — for moments when no view is there to show anything more. */
	private async probeChangeCount(): Promise<void> {
		if (!this.activeRepo) return;
		const seq = ++this.statusSeq;
		const reply = await loadStatus(this.repoContext());
		if (reply.type === 'error') this.trace(`status probe failed: ${reply.message}`);
		if (reply.type !== 'statusUpdate' || seq !== this.statusSeq) return;
		// Badge only. `lastChangeCount` is what the views are currently painted with, and it is the
		// baseline `needsFullReload` compares against — moving it here would make the deferred
		// refresh see no change when the view comes back, leaving the graph without its
		// "Uncommitted Changes" row until something forced a full reload.
		this.onChangeCount?.(reply.changeCount);
	}

	/** The working tree only — no history walk, no graph re-layout. */
	private async refreshStatus(): Promise<void> {
		const repoForRequest = this.activeRepo;
		const seq = ++this.statusSeq;
		const reply = await loadStatus(this.repoContext());
		// The guard below drops everything that is not a `statusUpdate`, so a failed read would look
		// exactly like one that found no changes. Traced before it is dropped.
		if (reply.type === 'error') this.trace(`status refresh failed: ${reply.message}`);
		if (reply.type !== 'statusUpdate' || seq !== this.statusSeq) return;
		// Same rule as send(): an answer about a repository the user switched away from is dropped.
		if (!this.stillCurrent(repoForRequest)) return;
		const previous = { changeCount: this.lastChangeCount, headHash: this.lastHeadHash };
		this.lastChangeCount = reply.changeCount;
		this.onChangeCount?.(reply.changeCount);
		if (needsFullReload(previous, { changeCount: reply.changeCount, headHash: reply.headHash })) {
			await this.refresh();
			return;
		}
		this.broadcast(reply);
	}

	/** Told by each container whether its webview is on screen; drives what refreshes are worth. */
	public setWebviewVisible(webview: ViewChannel, visible: boolean): void {
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
	private async handleMessage(message: WebviewToHost, webview: ViewChannel): Promise<void> {
		this.trace(`← ${message.type}`);
		try {
			await this.routeFromWebview(message, webview);
		} catch (error) {
			// Redacted before anything is traced or shown: git errors carry the remote URL, and a
			// remote URL can carry credentials.
			const detail = redactSecrets(error instanceof Error ? error.message : String(error));
			this.trace(
				`${message.type} FAILED: ${
					error instanceof Error ? redactSecrets(error.stack ?? detail) : detail
				}`
			);
			this.shell.notify.error(`Git Octopus: ${message.type} failed — ${detail}`);
			this.reply(webview, {
				type: 'error',
				message: `${message.type} failed: ${detail}`,
				repos: this.repos,
				activeRepo: this.activeRepo,
				source: message.type,
			} satisfies HostToWebview);
		}
	}

	/**
	 * An action stamped with the repository its menu or dialog was built over must still match the
	 * repository everything acts on now. When they differ, the view the action came from was
	 * looking at something that is no longer there — running it would mutate the wrong repo.
	 */
	private repoMismatch(message: { repoPath?: string }): boolean {
		// A missing stamp counts as a mismatch: the protocol requires it, so only a caller that
		// is not our webview code would ever omit it.
		if (message.repoPath === this.activeRepo) return false;
		this.shell.notify.warn(
			'Git Octopus: the active repository changed while this action was open — nothing was run. Refresh and try again.'
		);
		return true;
	}

	/** The product's own dialogs in the webview that acted; native UI if it vanished. */
	private promptFor(webview: ViewChannel): UserPrompt {
		return this.mapWebviewPrompt.get(webview) ?? this.shell.fallbackPrompt;
	}

	private async routeFromWebview(message: WebviewToHost, webview: ViewChannel): Promise<void> {
		const cwd = this.activeRepo;
		const prompt = this.promptFor(webview);

		switch (message.type) {
			case 'viewFocus':
				this.setViewFocus(webview, message.focused);
				return;
			case 'hostNoticeReply':
			case 'hostProgressCancel':
				this.shell.receiveViewReply?.(message);
				return;
			case 'loadCommits':
				if (message.filters) {
					this.filters = message.filters;
					this.persist();
				}
				this.lastLimit = message.limit;
				this.mapWebviewLimit.set(webview, message.limit);
				// This is also the webview telling us it is listening, so the icons and the saved view
				// settings ride along: a message posted before then would be dropped. Neither is
				// allowed to stand between the view and its commits, hence the guard.
				try {
					if (this.shell.capabilities) {
						this.reply(webview, { type: 'capabilities', ...this.shell.capabilities });
					}
					this.sendIconTheme(webview);
					this.sendColorTheme(webview);
					this.sendEditorPrefs(webview);
					this.sendViewSettings(webview);
				} catch (error) {
					this.trace(
						`sending icons/settings FAILED: ${
							error instanceof Error ? (error.stack ?? error.message) : String(error)
						}`
					);
					this.shell.notify.warn(
						`Git Octopus: could not send the icon theme or saved settings — ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
				this.trace(`loadCommits(limit=${message.limit}) — scanning for repositories`);
				await this.discoverRepos();
				this.trace(
					`found ${this.repos.length} repositories, active = ${this.activeRepo ?? 'none'}`
				);
				// The answer goes to every view, so it is loaded at the deepest limit any of them
				// needs — a fresh tab's first page must not shrink a panel scrolled 900 commits in.
				await this.send({ ...message, limit: this.broadcastLimit });
				this.trace('commits reply sent');
				return;
			case 'selectRepo':
				await this.selectRepo(message.path);
				return;
			case 'loadIdentity':
				await this.sendIdentity();
				return;
			case 'identityAction': {
				// The message is deliberately mixed: adding an identity and switching to it is one
				// user action, and sending it as one keeps the save from racing the reload that
				// follows. Only the switch is repo-scoped, so the saved list is persisted above both
				// the no-repository check and the guard — a workspace with no repo, or a repo that
				// changed under an open dialog, must not swallow an account the user just typed.
				// Persisting first also matters on the happy path: applying triggers a reload, and a
				// save still in flight would be read back as if the identity had never been added.
				let savedList = false;
				if (message.listIdentities) {
					await this.shell.settings.update('identities', message.listIdentities);
					savedList = true;
				}
				if (!cwd || this.repoMismatch(message)) {
					// One broadcast, at the end: an early one would carry the old repo's identity
					// alongside the new list and re-run the view's auto-apply against stale state.
					if (savedList) await this.sendIdentity();
					return;
				}
				try {
					if (message.action === 'apply' && message.name && message.email) {
						await setLocalIdentity(this.executor, cwd, message.name, message.email);
						this.shell.notify.info(
							`Git Octopus: this repository now commits as ${message.name} <${message.email}>.`
						);
					} else if (message.action === 'clearOverride') {
						await clearLocalIdentity(this.executor, cwd);
					}
				} catch (error) {
					this.shell.notify.error(`Git Octopus: ${String(error)}`);
				}
				await this.sendIdentity();
				return;
			}
			// No repo stamp on purpose: this writes a global setting and touches no repository, so
			// there is nothing a stale stamp could protect — only an account it could throw away.
			case 'saveIdentities':
				await this.shell.settings.update('identities', message.listIdentities);
				await this.sendIdentity();
				return;
			case 'loadBranchInventory':
				await this.sendBranchInventory(webview);
				return;
			case 'uiReply':
				// Answers are only ever accepted from the webview the question was sent to.
				this.mapWebviewPrompt.get(webview)?.handleReply(message);
				return;
			case 'cleanupBranches': {
				if (!cwd || this.repoMismatch(message)) return;
				const { listResults, changed } = await this.branchCleanup.run(message, cwd);
				this.reply(webview, {
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
				if (cwd) this.shell.open.openTerminal(cwd);
				return;
			case 'saveViewSettings':
				// Not awaited: the view is waiting on its own messages behind this one, and a write to
				// extension storage must never be what stands between it and its commits.
				void this.shell.globalState.update(STATE_VIEW_SETTINGS, message.settings);
				// Every other view gets the change too, so two open panels never disagree. Posting the
				// settings we were handed rather than re-reading storage: the write above is
				// deliberately not awaited, so a read-back could still answer with the old blob.
				this.trace('→ viewSettings (fan-out)');
				this.broadcastExcept(webview, { type: 'viewSettings', settings: message.settings });
				return;
			case 'copyText':
				await this.shell.clipboard.writeText(message.text);
				this.shell.notify.info(`Git Octopus: ${message.label} copied.`);
				return;
			case 'openDiff':
				if (cwd)
					await this.shell.editorDiff.openDiff(message.hash, message.path, cwd, message.oldPath);
				return;
			case 'openCompareDiff':
				if (cwd)
					await this.shell.editorDiff.openCompareDiff(
						message.fromHash,
						message.toHash,
						message.path,
						cwd,
						message.oldPath
					);
				return;
			case 'openWorkingDiff':
				if (cwd) await this.shell.editorDiff.openWorkingDiff(message.path, cwd);
				return;
			case 'openFile':
				if (cwd) await this.shell.editorDiff.openFile(message.path, cwd, message.hash);
				return;
			case 'copyFilePath':
				if (cwd) {
					const text = message.absolute ? path.join(cwd, message.path) : message.path;
					await this.shell.clipboard.writeText(text);
					this.shell.notify.info(`Git Octopus: ${text} copied.`);
				}
				return;
			case 'commitAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (
					await this.undo.record(commitActionLabel(message), cwd, () =>
						this.actions.run(message, cwd, prompt)
					)
				)
					await this.refresh();
				return;
			case 'squashCommits':
				if (!cwd || this.repoMismatch(message)) return;
				if (
					await this.undo.record(squashLabel(message.hashes.length), cwd, () =>
						this.actions.squash(message, cwd, prompt)
					)
				)
					await this.refresh();
				return;
			case 'multiCommitAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (
					await this.undo.record(multiActionLabel(message), cwd, () =>
						this.actions.runMulti(message, cwd, prompt)
					)
				)
					await this.refresh();
				return;
			case 'cherryPickCommits': {
				if (!cwd || this.repoMismatch(message)) return;
				const count = message.listHashes.length;
				if (
					await this.undo.record(
						`cherry-pick of ${count} commit${count === 1 ? '' : 's'}`,
						cwd,
						() => this.actions.cherryPickList(message, cwd)
					)
				)
					await this.refresh();
				return;
			}
			case 'sequencerAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.repoActions.runSequencer(message, cwd, prompt)) await this.refresh();
				return;
			case 'branchAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (
					await this.undo.record(branchActionLabel(message), cwd, () =>
						this.actions.runBranchAction(message, cwd, prompt)
					)
				)
					await this.refresh();
				return;
			case 'undoAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.undo.run(cwd)) await this.refresh();
				return;
			case 'redoAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.undo.redo(cwd)) await this.refresh();
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
			case 'workingTreeAction': {
				if (!cwd || this.repoMismatch(message)) return;
				const done = await this.workingTree.run(message, cwd, prompt);
				if (message.action === 'commit' || message.action === 'amend') {
					this.reply(webview, { type: 'commitOutcome', ok: done } satisfies HostToWebview);
				}
				if (!done) return;
				await this.refresh();
				// Only after the commit landed: a failed hook or an empty message pushes nothing.
				if (message.action === 'commit' && message.pushAfter) {
					const pushed = await this.repoActions.run(
						{ type: 'repoAction', repoPath: message.repoPath, action: 'push' },
						cwd,
						prompt
					);
					if (pushed) await this.refresh();
				}
				return;
			}
			case 'loadRebaseTodo': {
				if (!cwd) return;
				this.reply(webview, await this.interactiveRebase.load(message.base, cwd, message.branch));
				return;
			}
			case 'interactiveRebase': {
				if (!cwd || this.repoMismatch(message)) return;
				const count = message.listSteps.length;
				const label = `interactive rebase of ${count} commit${count === 1 ? '' : 's'}`;
				if (await this.undo.record(label, cwd, () => this.interactiveRebase.run(message, cwd)))
					await this.refresh();
				return;
			}
			case 'loadRemotes': {
				this.reply(webview, {
					type: 'remotes',
					listRemotes: cwd ? await getRemotes(this.executor, cwd).catch(() => []) : [],
				} satisfies HostToWebview);
				return;
			}
			case 'remoteAction': {
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.repoActions.runRemoteAction(message, cwd, prompt)) await this.refresh();
				// Answered either way, so the tab never shows a remote list the action did not leave.
				this.reply(webview, {
					type: 'remotes',
					listRemotes: await getRemotes(this.executor, cwd).catch(() => []),
				} satisfies HostToWebview);
				return;
			}
			case 'loadSigning':
				await this.sendSigning(webview);
				return;
			case 'signingAction': {
				if (!cwd || this.repoMismatch(message)) return;
				try {
					await setSigningConfig(this.executor, cwd, message.mapValues);
				} catch (error) {
					this.shell.notify.error(
						`Git Octopus: ${redactSecrets(error instanceof Error ? error.message : String(error))}`
					);
				}
				await this.sendSigning(webview);
				// What verifies a signature may just have changed; badges already drawn would lie.
				if (this.filters.showSignatures) await this.refresh();
				return;
			}
			case 'loadWorktrees': {
				this.reply(webview, {
					type: 'worktrees',
					listWorktrees: cwd ? await getWorktrees(this.executor, cwd).catch(() => []) : [],
				} satisfies HostToWebview);
				return;
			}
			case 'loadRefPanel':
				this.setRefPanelViews.add(webview);
				await this.sendRefPanel();
				return;
			case 'worktreeAction': {
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.worktrees.run(message, cwd, prompt)) await this.refresh();
				// Answered either way, so the list never shows a worktree the action did not leave.
				this.reply(webview, {
					type: 'worktrees',
					listWorktrees: await getWorktrees(this.executor, cwd).catch(() => []),
				} satisfies HostToWebview);
				return;
			}
			case 'loadCommitTemplate': {
				this.reply(webview, {
					type: 'commitTemplate',
					text: cwd
						? await readCommitTemplate(
								this.executor,
								cwd,
								(file) => fs.readFile(file, 'utf8'),
								os.homedir()
							)
						: null,
				} satisfies HostToWebview);
				return;
			}
			case 'stageLines':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.workingTree.stageLines(message, cwd, prompt)) await this.refresh();
				return;
			case 'repoAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.repoActions.run(message, cwd, prompt)) await this.refresh();
				return;
			case 'detectAgents':
				this.reply(webview, await this.commitAgent.detect());
				return;
			case 'saveAiSettings': {
				await this.commitAgent.saveSettings(message);
				// Every view re-reads the same truth, so the settings tab and any open dialog agree.
				const inventory = await this.commitAgent.detect();
				this.broadcast(inventory);
				return;
			}
			case 'selectAgent':
				// The fresh inventory is the ack: the webview starts generating only once it says
				// the pick and the consent are stored, so the two messages cannot race.
				await this.commitAgent.select(message.agentId);
				this.reply(webview, await this.commitAgent.detect());
				return;
			case 'generateCommitPlan': {
				if (!cwd || this.repoMismatch(message)) return;
				if (message.stageAll) {
					// Awaited: generation reads the tree, so it must not start until the staging it was
					// asked to generate over has actually landed.
					const staged = await this.workingTree.run(
						{ type: 'workingTreeAction', repoPath: message.repoPath, action: 'stageAll' },
						cwd,
						prompt
					);
					if (!staged) return;
					await this.refresh();
				}
				// Broadcast, not reply: the view that asked may be gone by the time the agent
				// answers, and every attached view (panel, editor tab) shows the same plan.
				const result = await this.commitAgent.generate(message, cwd, (progress) => {
					this.broadcast(progress);
				});
				this.broadcast(result);
				return;
			}
			case 'aiExplain':
				if (!cwd || this.repoMismatch(message)) return;
				await this.commitAgent.explain(message, cwd);
				return;
			case 'cancelCommitPlan':
				// Deliberately unguarded, unlike every other `repoPath`-stamped message. Cancelling
				// mutates nothing and acts on the repo named in the message, so it cannot hit the wrong
				// one — while a guard here would strand a running agent the moment the user switched
				// repositories, with no other way to stop it.
				this.commitAgent.cancel(message.repoPath);
				return;
			case 'loadCommitPlanState':
				// Per-view query: the answer describes host state, and only the asker is catching up.
				this.reply(webview, this.commitAgent.state(message.repoPath));
				return;
			case 'executeCommitPlan': {
				if (!cwd || this.repoMismatch(message)) return;
				const reply = await this.commitAgent.execute(message, cwd);
				this.reply(webview, reply);
				if (reply.committed > 0) await this.refresh();
				return;
			}
			case 'loadWorkspaceIdentities': {
				this.reply(webview, {
					type: 'workspaceIdentities',
					listRepos: await this.readWorkspaceIdentities(),
				} satisfies HostToWebview);
				return;
			}
			// Per-view queries: the answer belongs to the panel that asked. Broadcasting it would
			// overwrite the other panels' selection with this one's.
			case 'loadCommitDetails':
			case 'loadComparison':
			case 'loadFileDiff':
			case 'loadFileHistory':
			case 'loadBlame':
			case 'loadCommitStats': {
				const repoForRequest = this.activeRepo;
				const reply = await routeMessage(message, this.repoContext(), this.filters);
				// Answers computed for a repository the user has since switched away from are dropped.
				if (reply && this.stillCurrent(repoForRequest)) this.reply(webview, reply);
				return;
			}
			default:
				assertNever(message);
		}
	}

	/**
	 * "Merged" is measured against the checked-out branch, falling back to HEAD when it is detached:
	 * whatever the user is standing on is what they consider already-integrated work.
	 */
	private async sendBranchInventory(webview: ViewChannel): Promise<void> {
		const cwd = this.activeRepo;
		if (!cwd) {
			this.reply(webview, {
				type: 'branchInventory',
				listBranches: [],
				mergedBase: null,
			} satisfies HostToWebview);
			return;
		}
		const base = (await getCurrentBranch(this.executor, cwd)) ?? 'HEAD';
		const inventory = await getBranchInventory(this.executor, cwd, base);
		this.reply(webview, { type: 'branchInventory', ...inventory } satisfies HostToWebview);
	}

	/**
	 * One entry per workspace repository. A repository that fails to answer (deleted underneath
	 * us, broken config) becomes a blank row rather than taking the whole table down with it.
	 */
	private async readWorkspaceIdentities(): Promise<WorkspaceIdentityEntry[]> {
		return Promise.all(
			this.repos.map(async (repo): Promise<WorkspaceIdentityEntry> => {
				try {
					const identity = await getRepoIdentity(this.executor, repo.path);
					return {
						repoPath: repo.path,
						repoName: repo.name,
						name: identity.name,
						email: identity.email,
						overridden: identity.hasLocalName || identity.hasLocalEmail,
					};
				} catch {
					return {
						repoPath: repo.path,
						repoName: repo.name,
						name: null,
						email: null,
						overridden: false,
					};
				}
			})
		);
	}

	/** Read the active repo's identity plus the saved identities, and push them to every webview. */
	private async sendSigning(webview: ViewChannel): Promise<void> {
		const cwd = this.activeRepo;
		this.reply(webview, {
			type: 'signing',
			repoPath: cwd,
			...(cwd
				? await getSigningConfig(this.executor, cwd)
				: { mapValues: {}, listLocalKeys: [], gitVersion: null }),
		});
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
		const listIdentities = this.shell.settings.get<GitIdentity[]>('identities', []);
		this.broadcast({ type: 'identity', repoPath: cwd, ...identity, listIdentities });
	}

	/**
	 * Post to every attached view. The Panel view and any editor tabs show the same repository, so
	 * anything describing that repository goes to all of them.
	 */
	private broadcast(message: HostToWebview): void {
		for (const webview of this.listWebviews) void webview.postMessage(message);
	}

	/** Post to the one view that asked — answers scoped to a request, never to the repository. */
	private reply(webview: ViewChannel, message: HostToWebview): void {
		void webview.postMessage(message);
	}

	/** Post to every view except the one that acted — for state a view already applied locally. */
	private broadcastExcept(acting: ViewChannel, message: HostToWebview): void {
		for (const webview of this.listWebviews) {
			if (webview !== acting) void webview.postMessage(message);
		}
	}

	/**
	 * Whether an answer computed for `repoForRequest` still describes the repository on screen.
	 *
	 * Requests run concurrently, so a slow one can land after the user has switched repositories —
	 * and posting it would paint the old repo's data over the new one. Every path that awaits git
	 * and then posts has to ask this; it is one rule, so it lives in one place.
	 */
	private stillCurrent(repoForRequest: string | null): boolean {
		return this.activeRepo === repoForRequest;
	}

	private async send(message: WebviewToHost): Promise<void> {
		if (this.listWebviews.length === 0) return;
		const repoForRequest = this.activeRepo;
		const seq = message.type === 'loadCommits' ? ++this.statusSeq : null;
		const reply = await routeMessage(message, this.repoContext(), this.filters);
		if (!reply) return;
		// The active repository moved while this request was in flight — see `stillCurrent`.
		if (!this.stillCurrent(repoForRequest)) return;
		// The graph itself still posts below — only the badge and its baseline are skipped when a
		// newer status read has started, so a slow load cannot write an old count over a new one.
		if (reply.type === 'commits' && seq === this.statusSeq) {
			this.lastChangeCount = reply.working
				? reply.working.staged.length + reply.working.unstaged.length
				: 0;
			this.lastHeadHash = reply.headHash;
			this.onChangeCount?.(this.lastChangeCount);
			this.onRepoState?.({ repoName: reply.repoName, branch: reply.currentBranch });
		}
		this.broadcast(reply);
		// Every path that reloads the graph — refresh(), the toolbar and the desktop keyboard's
		// own `loadCommits` — ends here, so the side panel follows the graph from one place.
		if (reply.type === 'commits') await this.sendRefPanel();
	}

	/** Re-scan the workspace, keeping the active repository when it still exists. */
	private async discoverRepos(): Promise<void> {
		const listRoots = this.shell.listRoots();
		this.repos = await withSubmodules(await findRepos(listRoots), (repoPath) =>
			getSubmodulePaths(this.executor, repoPath)
		);
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
			pathExists,
			readBlob,
		};
	}
}
