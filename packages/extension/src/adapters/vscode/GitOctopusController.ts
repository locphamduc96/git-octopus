import * as vscode from 'vscode';
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
import { BranchCleanupService } from './BranchCleanupService.js';
import { routeMessage } from '../../app/messageRouter.js';
import type { RepoContext } from '../../app/useCases/loadCommits.js';
import { loadStatus } from '../../app/useCases/loadStatus.js';
import { decideRefresh, needsFullReload, type RefreshKind } from '../../core/refreshPolicy.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { nativePrompt } from './nativePrompt.js';
import { WebviewPromptBroker } from './webviewPrompt.js';
import { findRepos } from '../fs/repoScanner.js';
import type { DiffService } from './DiffService.js';
import type { CommitActionService } from './CommitActionService.js';
import type { WorkingTreeService } from './WorkingTreeService.js';
import type { RepoActionService } from './RepoActionService.js';
import type { CommitAgentService } from './CommitAgentService.js';
import { gravatarUrl } from '../process/gravatar.js';
import { buildForWebview, locateIconTheme, type LocatedIconTheme } from './iconThemeReader.js';
import { renderWebviewHtml } from './webviewShell.js';

/**
 * Traces what the view asked for and how far the answer got. A hang shows up here as the step it
 * never reached — which is the one thing an empty "Loading…" cannot tell anyone.
 */
const log = vscode.window.createOutputChannel('Git Octopus');
function trace(message: string): void {
	log.appendLine(`${new Date().toISOString().slice(11, 23)} ${message}`);
}

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
	/**
	 * What each attached view asked for. One view scrolling deep into history must not be cut
	 * back to another view's page size when that one loads — every shared answer covers the
	 * deepest request still on screen.
	 */
	private readonly mapWebviewLimit = new Map<vscode.Webview, number>();
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
	private readonly mapWebviewVisible = new Map<vscode.Webview, boolean>();
	/** One prompt broker per attached webview — questions go back to the view that acted. */
	private readonly mapWebviewPrompt = new Map<vscode.Webview, WebviewPromptBroker>();
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
		private readonly commitAgent: CommitAgentService,
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

	/** Notified with the working-tree change count (drives the view badges, like SCM's). */
	public onChangeCount?: (count: number) => void;

	/** The repository everything currently acts on — the sidebar tree reads from here. */
	public get activeRepoPath(): string | null {
		return this.activeRepo;
	}

	/** Bring the graph forward and scroll it to a commit (used by the sidebar tree). */
	public async revealCommit(hash: string): Promise<void> {
		await vscode.commands.executeCommand('git-octopus.view.focus');
		this.broadcast({ type: 'revealCommit', hash });
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
		webview.html = renderWebviewHtml(webview, mediaUri);

		trace('webview attached');
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
			this.mapWebviewPrompt.get(webview)?.cancelAll();
			this.mapWebviewPrompt.delete(webview);
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
		this.reply(webview, { type: 'viewSettings', settings } satisfies HostToWebview);
	}

	private sendIconTheme(webview: vscode.Webview): void {
		this.reply(webview, {
			type: 'fileIcons',
			theme: this.iconTheme ? buildForWebview(this.iconTheme, webview) : null,
		} satisfies HostToWebview);
	}

	/** Dark or light, for the diff panel's syntax colours. High contrast maps to its base kind. */
	private sendColorTheme(webview: vscode.Webview): void {
		const kind = vscode.window.activeColorTheme.kind;
		const light =
			kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
		this.reply(webview, {
			type: 'colorTheme',
			kind: light ? 'light' : 'dark',
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
	}

	/**
	 * React to the repository changing on disk. Cheap by default: only a moved HEAD reloads the
	 * graph, and nothing runs at all while no webview can see the result.
	 */
	public async autoRefresh(kind: RefreshKind): Promise<void> {
		const enabled = vscode.workspace
			.getConfiguration('gitOctopus')
			.get<boolean>('autoRefresh', true);
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
		if (reply.type === 'error') trace(`status probe failed: ${reply.message}`);
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
		if (reply.type === 'error') trace(`status refresh failed: ${reply.message}`);
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
			// Redacted before anything is traced or shown: git errors carry the remote URL, and a
			// remote URL can carry credentials.
			const detail = redactSecrets(error instanceof Error ? error.message : String(error));
			trace(
				`${message.type} FAILED: ${
					error instanceof Error ? redactSecrets(error.stack ?? detail) : detail
				}`
			);
			vscode.window.showErrorMessage(`Git Octopus: ${message.type} failed — ${detail}`);
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
		vscode.window.showWarningMessage(
			'Git Octopus: the active repository changed while this action was open — nothing was run. Refresh and try again.'
		);
		return true;
	}

	/** The product's own dialogs in the webview that acted; native UI if it vanished. */
	private promptFor(webview: vscode.Webview): UserPrompt {
		return this.mapWebviewPrompt.get(webview) ?? nativePrompt;
	}

	private async routeFromWebview(message: WebviewToHost, webview: vscode.Webview): Promise<void> {
		const cwd = this.activeRepo;
		const prompt = this.promptFor(webview);

		switch (message.type) {
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
				// The answer goes to every view, so it is loaded at the deepest limit any of them
				// needs — a fresh tab's first page must not shrink a panel scrolled 900 commits in.
				await this.send({ ...message, limit: this.broadcastLimit });
				trace('commits reply sent');
				return;
			case 'selectRepo':
				// Only a repository this controller discovered may become active: everything else
				// runs `git` with this value as its working directory.
				if (!this.repos.some((repo) => repo.path === message.path)) return;
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
				if (cwd) vscode.window.createTerminal({ name: 'Git Octopus', cwd }).show();
				return;
			case 'saveViewSettings':
				// Not awaited: the view is waiting on its own messages behind this one, and a write to
				// extension storage must never be what stands between it and its commits.
				void this.globalState.update(STATE_VIEW_SETTINGS, message.settings);
				// Every other view gets the change too, so two open panels never disagree. Posting the
				// settings we were handed rather than re-reading storage: the write above is
				// deliberately not awaited, so a read-back could still answer with the old blob.
				trace('→ viewSettings (fan-out)');
				this.broadcastExcept(webview, { type: 'viewSettings', settings: message.settings });
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
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.actions.run(message, cwd, prompt)) await this.refresh();
				return;
			case 'squashCommits':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.actions.squash(message, cwd, prompt)) await this.refresh();
				return;
			case 'multiCommitAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.actions.runMulti(message, cwd, prompt)) await this.refresh();
				return;
			case 'sequencerAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.repoActions.runSequencer(message, cwd, prompt)) await this.refresh();
				return;
			case 'branchAction':
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.actions.runBranchAction(message, cwd, prompt)) await this.refresh();
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
				if (!cwd || this.repoMismatch(message)) return;
				if (await this.workingTree.run(message, cwd, prompt)) await this.refresh();
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
				// Broadcast, not reply: the view that asked may be gone by the time the agent
				// answers, and every attached view (panel, editor tab) shows the same plan.
				const result = await this.commitAgent.generate(message, cwd, (progress) => {
					this.broadcast(progress);
				});
				this.broadcast(result);
				return;
			}
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
			case 'loadFileDiff': {
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
	private async sendBranchInventory(webview: vscode.Webview): Promise<void> {
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
		this.broadcast({ type: 'identity', ...identity, listIdentities });
	}

	/**
	 * Post to every attached view. The Panel view and any editor tabs show the same repository, so
	 * anything describing that repository goes to all of them.
	 */
	private broadcast(message: HostToWebview): void {
		for (const webview of this.listWebviews) void webview.postMessage(message);
	}

	/** Post to the one view that asked — answers scoped to a request, never to the repository. */
	private reply(webview: vscode.Webview, message: HostToWebview): void {
		void webview.postMessage(message);
	}

	/** Post to every view except the one that acted — for state a view already applied locally. */
	private broadcastExcept(acting: vscode.Webview, message: HostToWebview): void {
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
}
