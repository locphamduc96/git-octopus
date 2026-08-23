<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import type {
		BranchActionId,
		GraphFilters,
		BranchCleanupOutcome,
		BranchInventoryEntry,
		BranchRef,
		Commit,
		CommitActionId,
		CommitDetails,
		DiffHunk,
		GitIdentity,
		GraphRow,
		HostToWebview,
		RemoteBranchRef,
		RepoInfo,
		UiRequestMessage,
		RepoState,
		SequencerActionMessage,
		WorkingTreeAction,
		WorkspaceIdentityEntry,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import { UNCOMMITTED_HASH } from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost, readState, writeState, STATE_VERSION } from './lib/bridge';
	import { buildHostFilters, commitsReplyMatches, loadSignature } from './lib/commitsGuard';
	import { dispatchHostMessage, resetForRepo } from './lib/hostRouter';
	import { buildDiffKey, isCacheableDiffKey } from './lib/diffKey';
	import { buildRefPayload } from './lib/refPayload';
	import type { RefTarget } from './lib/graphMenu';
	import { nextRowIndex } from './lib/keyNav';
	import { buildPanelFiles, stepPath } from './lib/panelFiles';
	import {
		DEFAULT_VIEW_SETTINGS,
		mergePreferences,
		settingsRequireReload,
		type ColumnKey,
		type ColumnVisibility,
		type ColumnWidths,
		type GlobalPreferences,
		type RepoIdentityState,
		type ViewSettings,
	} from './lib/viewSettings';
	import ControlBar from './features/control-bar/ControlBar.svelte';
	import DiffPanel from './features/diff/DiffPanel.svelte';
	import FindWidget from './features/find/FindWidget.svelte';
	import GraphView from './features/graph/GraphView.svelte';
	import GraphSkeleton from './features/graph/GraphSkeleton.svelte';
	import ChangesPanel, {
		type ComparisonState,
		type PanelMode,
	} from './features/changes-panel/ChangesPanel.svelte';
	import IdentityDialog from './features/settings/IdentityDialog.svelte';
	import BranchCleanupDialog from './features/branch-cleanup/BranchCleanupDialog.svelte';
	import SettingsWidget from './features/settings/SettingsWidget.svelte';
	import type { FileViewMode } from './lib/fileTree';
	import { fontFaceCss } from './lib/fileIcon';
	import { guessThemeKind, langForPath, tokenizeHunks, type HighlightToken } from './lib/highlight';
	import { identityMismatch, listMatchedIdentities, matchIdentity } from './lib/identity';
	import { planCommitGuard } from './lib/commitGuard';
	import { planAutoApply } from './lib/identityAutoApply';
	import { planReveal } from './lib/revealPlan';
	import { selectRange } from './lib/squashRange';
	import { fileIconTheme, setFileIconTheme } from './lib/stores/fileIcons.svelte';
	import Splitter from './lib/ui/Splitter.svelte';
	import { motionMs } from './lib/ui/motion';
	import ConfirmDialog from './lib/ui/ConfirmDialog.svelte';
	import OptionsDialog from './lib/ui/OptionsDialog.svelte';
	import TextInputDialog from './lib/ui/TextInputDialog.svelte';

	/**
	 * A glyph-based icon theme (Seti, the VS Code default) ships its icons inside a font, which has
	 * to be declared before any character renders. Written as a real stylesheet node rather than
	 * markup, so nothing from the theme file is ever parsed as HTML.
	 */
	$effect(() => {
		const css = fontFaceCss(fileIconTheme());
		if (!css) return;
		const element = document.createElement('style');
		element.textContent = css;
		document.head.append(element);
		return () => element.remove();
	});

	type Status = 'loading' | 'ready' | 'error';
	const STACK_BREAKPOINT = 768;

	let status = $state<Status>('loading');
	let rows = $state<GraphRow[]>([]);
	let repoName = $state<string | null>(null);
	let errorMessage = $state('');
	let working = $state<WorkingTreeStatus | null>(null);

	let repos = $state<RepoInfo[]>([]);
	let activeRepo = $state<string | null>(null);
	let repoState = $state<RepoState | null>(null);
	let hasMore = $state(false);
	/** Grows as the user scrolls past the end; reset when the repo or page size changes. */
	let graphLimit = $state(0);
	let currentBranch = $state<string | null>(null);
	/** Only meaningful while `currentBranch` is null: the branch the detached HEAD came from. */
	let previousBranch = $state<string | null>(null);
	let headHash = $state<string | null>(null);
	let listBranches = $state<BranchRef[]>([]);
	/** A branch pick waiting on more history, with the pages of it still worth loading. */
	let pendingJump = $state<{ branch: BranchRef; pagesLeft: number } | null>(null);
	/** The same, for the detached-HEAD banner's "Show commit". */
	let pendingHeadReveal = $state<{ pagesLeft: number } | null>(null);
	let notice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;
	const stored = readState();
	// Sizes saved against a different layout are ignored, so a changed default still lands.
	const saved = stored.version === STATE_VERSION ? stored : {};
	// Author is off by default: avatars now sit on the commit nodes, so the column is redundant.
	let columns = $state<ColumnVisibility>({ author: false, commit: false, date: true });
	let widths = $state<ColumnWidths>({
		ref: 180,
		author: 140,
		commit: 90,
		date: 150,
		...saved.widths,
	});
	let ahead = $state(0);
	let behind = $state(0);

	let findOpen = $state(false);
	let findQuery = $state('');

	let selectedHash = $state<string | null>(null);
	/** Shift-click range selection, in row order; empty unless it spans at least two commits. */
	let listSelected = $state<string[]>([]);
	/** The moving end of a shift-selection — where Shift+Arrow continues from. */
	let rangeEnd = $state<string | null>(null);
	let details = $state<CommitDetails | null>(null);
	let detailsLoading = $state(false);

	let fileView = $state<FileViewMode>('tree');
	let metaOpen = $state(false);
	let settingsOpen = $state(false);
	// The defaults live in `lib/viewSettings`; the user's choices arrive as a `viewSettings`
	// message and are laid over them by `mergePreferences`.
	let settings = $state<ViewSettings>({ ...DEFAULT_VIEW_SETTINGS });

	/**
	 * What the host has, as far as this view knows. Two open panels each save and each receive the
	 * other's save; without this they would answer each other forever over an unchanged value.
	 */
	let syncedPreferences = '';
	/**
	 * Nothing is saved before the host has said what it holds.
	 *
	 * Without this the very first thing a fresh view does is post its *defaults* — which the host
	 * would store, wiping the preferences it was about to send back. Every window opened would
	 * quietly reset the settings of every other one.
	 */
	let preferencesLoaded = $state(false);

	function applyPreferences(stored: Record<string, unknown> | null): void {
		preferencesLoaded = true;
		if (stored) {
			const merged = mergePreferences({ settings, columns, fileView, metaOpen }, stored);
			settings = merged.settings;
			columns = merged.columns;
			fileView = merged.fileView;
			metaOpen = merged.metaOpen;
			syncedPreferences = preferencesJson();
			// The first load went out with the defaults, because the saved settings only arrive in
			// answer to it. When they change what the host walk produces — order, limit, stashes,
			// avatars — that first answer is already wrong, so ask again with the real settings.
			// Self-limiting: once the loaded data matches the settings, the signatures agree.
			if (currentLoadSignature() !== lastLoadSignature) {
				graphLimit = 0;
				load();
			}
			return;
		}
		// Nothing stored: write the defaults once, so there is something to load next time.
		savePreferences();
	}

	function preferencesJson(): string {
		return JSON.stringify({ settings, columns, fileView, metaOpen });
	}

	function savePreferences(): void {
		if (!preferencesLoaded) return;
		const json = preferencesJson();
		if (json === syncedPreferences) return;
		syncedPreferences = json;
		postToHost({
			type: 'saveViewSettings',
			settings: { settings, columns, fileView, metaOpen } satisfies GlobalPreferences,
		});
	}

	$effect(savePreferences);

	/** Always read live: the guard compares a reply against what the view wants *now*. */
	function hostFilters(): GraphFilters {
		return buildHostFilters(settings);
	}

	let repoIdentity = $state<RepoIdentityState | null>(null);
	let listIdentities = $state<GitIdentity[]>([]);
	let addingIdentity = $state(false);
	/** Every workspace repository's effective identity, asked for each time settings open. */
	let listWorkspaceIdentities = $state<WorkspaceIdentityEntry[]>([]);
	/** The commit-time question: the user is about to commit with an email the remote disagrees with. */
	let commitGuard = $state<{ suggested: GitIdentity; message?: string } | null>(null);
	/**
	 * A commit waiting for the identity switch it asked for. The host handles `identityAction` and
	 * `workingTreeAction` independently, so posting both at once could commit under the old email;
	 * the commit goes out only once an `identity` reply shows the switch has landed.
	 */
	let pendingCommitAwaitIdentity = $state<{ email: string; message?: string } | null>(null);

	/**
	 * Questions the host asks this view to render (feature-040). One dialog at a time — the
	 * rest wait in arrival order; each is answered exactly once by its requestId.
	 */
	let uiRequest = $state<UiRequestMessage | null>(null);
	let listUiQueue: UiRequestMessage[] = [];

	function replyUi(reply: {
		requestId: string;
		confirmed?: boolean;
		listSelected?: string[];
		text?: string;
		cancelled?: boolean;
	}): void {
		postToHost({ type: 'uiReply', ...reply });
		uiRequest = listUiQueue.shift() ?? null;
	}

	function cancelUi(): void {
		if (uiRequest) replyUi({ requestId: uiRequest.requestId, cancelled: true });
	}

	let cleanupOpen = $state(false);
	let cleanupInventory = $state<{
		listBranches: BranchInventoryEntry[];
		mergedBase: string | null;
	} | null>(null);
	let cleanupResults = $state<BranchCleanupOutcome[] | null>(null);

	function openCleanup(): void {
		// Always re-scan: branches move between openings, and a stale list would offer to delete a
		// branch that has since been pushed to.
		cleanupInventory = null;
		cleanupResults = null;
		cleanupOpen = true;
		postToHost({ type: 'loadBranchInventory' });
	}

	/** Saved identity currently in use, mismatch warning, and the chip label they produce. */
	const activeIdentity = $derived(matchIdentity(listIdentities, repoIdentity?.email ?? null));
	const identityWarningFor = $derived(
		repoIdentity
			? identityMismatch(listIdentities, repoIdentity.listRemoteUrls, repoIdentity.email)
			: null
	);
	const identityWarning = $derived(
		identityWarningFor
			? `This repository's remote suggests the "${identityWarningFor.label}" identity (${identityWarningFor.email}), but commits will use ${repoIdentity?.email ?? 'no email'}. Open settings to switch.`
			: null
	);
	const identityLabel = $derived(
		activeIdentity ? activeIdentity.label : (repoIdentity?.email ?? null)
	);

	let comparison = $state<ComparisonState>({
		fromHash: null,
		toHash: null,
		files: [],
		loading: false,
	});
	/**
	 * The file the diff panel is showing, in place of the graph. Null whenever the graph is up —
	 * including when diffs are set to open in a VS Code editor instead.
	 */
	interface DiffTargetState {
		path: string;
		/** The path before a rename, so the diff reads old → new instead of a whole-file add. */
		oldPath?: string;
		title: string;
		hash?: string;
		fromHash?: string;
		toHash?: string;
		untracked?: boolean;
	}
	let diffTarget = $state<DiffTargetState | null>(null);
	let diffHunks = $state<DiffHunk[]>([]);
	let diffNotice = $state<string | null>(null);
	let diffLoading = $state(false);
	/** True only while the diff is animating away — it is still drawn, so it must stop taking clicks. */
	let diffClosing = $state(false);
	/** Identifies the request in flight, so a reply for a file already navigated away from is dropped. */
	let diffKey = $state('');
	/** Diffs already fetched this session, keyed the same way. Prev/next then costs no git call. */
	const mapDiffCache = new Map<string, { listHunks: DiffHunk[]; notice?: string }>();

	/** Dark or light, told by the host; guessed from the body classes until that message arrives. */
	let themeKind = $state(guessThemeKind(document.body));
	/** Per-line syntax tokens for the open diff, or null while Shiki is not ready for it. */
	let listDiffTokens = $state<HighlightToken[][] | null>(null);
	/** Tokens per diff and theme, so revisiting a file or flipping the theme back is instant. */
	const mapDiffTokenCache = new Map<string, HighlightToken[][]>();
	/** Above this the whole-file view of a big file would hang the webview on tokenizing. */
	const MAX_HIGHLIGHT_LINES = 20_000;

	/**
	 * Tokenize the open diff in the background. The panel renders plain text immediately and the
	 * coloured spans swap in when Shiki has the grammar. Keyed off `diffKey`, so scrolling (which
	 * only changes the visible slice) never re-tokenizes, and a result landing after the user
	 * moved on is dropped.
	 */
	$effect(() => {
		const key = diffKey;
		const kind = themeKind;
		const path = diffTarget?.path;
		const listHunks = diffHunks;
		listDiffTokens = null;
		if (!path || listHunks.length === 0) return;
		const lang = langForPath(path);
		if (!lang) return;
		const cacheKey = `${key}@${kind}`;
		const cached = mapDiffTokenCache.get(cacheKey);
		if (cached) {
			listDiffTokens = cached;
			return;
		}
		const listHunkTexts = listHunks.map((hunk) => hunk.listLines.map((line) => line.text));
		if (
			listHunkTexts.reduce((total, listTexts) => total + listTexts.length, 0) > MAX_HIGHLIGHT_LINES
		)
			return;
		void tokenizeHunks(lang, listHunkTexts, kind).then((listTokens) => {
			if (!listTokens) return;
			if (isCacheableDiffKey(key)) mapDiffTokenCache.set(cacheKey, listTokens);
			if (key === diffKey && kind === themeKind) listDiffTokens = listTokens;
		});
	});

	let scrollTarget = $state<{ hash: string; nonce: number } | null>(null);
	/** The host's last answer about whether a drop could fast-forward, keyed by the question's nonce. */
	let fastForward = $state<{ nonce: number; canFastForward: boolean } | null>(null);

	/** The right panel follows the graph selection: no tab strip to keep in sync. */
	const panelMode = $derived<PanelMode>(
		comparison.fromHash && comparison.toHash
			? 'compare'
			: selectedHash && selectedHash !== UNCOMMITTED_HASH
				? 'commit'
				: 'changes'
	);

	let shell = $state<HTMLDivElement | null>(null);
	let shellWidth = $state(1200);
	let shellHeight = $state(600);
	let panelRatio = $state(saved.panelRatio ?? 0.35);

	// Only what belongs to this window: the rest lives in the host's global state.
	$effect(() => {
		writeState({ version: STATE_VERSION, widths, panelRatio });
	});

	const stacked = $derived(shellWidth < STACK_BREAKPOINT);

	/** Rows shown in the graph: filtered by the find query when one is active. */
	const visibleRows = $derived.by(() => {
		const query = findQuery.trim().toLowerCase();
		if (!findOpen || query === '') return rows;
		return rows.filter((row) => {
			const commit = row.commit;
			return (
				commit.subject.toLowerCase().includes(query) ||
				commit.author.name.toLowerCase().includes(query) ||
				commit.hash.toLowerCase().startsWith(query)
			);
		});
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey) {
			if (event.key === 'f') {
				event.preventDefault();
				findOpen = true;
			} else if (event.key === 'r') {
				event.preventDefault();
				load();
			} else if (event.key === 'h') {
				event.preventDefault();
				const head = rows.find((row) => row.commit.refs.some((ref) => ref.kind === 'head'));
				scrollTo(head?.commit.hash ?? null);
			} else if (event.key === 's') {
				event.preventDefault();
				const stash = rows.find((row) => row.commit.refs.some((ref) => ref.kind === 'stash'));
				scrollTo(stash?.commit.hash ?? null);
			}
			return;
		}
		navigateByKey(event);
	}

	/** How far PageUp/PageDown jump; roughly one screen of rows. */
	const PAGE_JUMP = 20;

	/** The panel's files in the order they are drawn — what ↑/↓ walk while a diff is open. */
	const listPanelFiles = $derived(
		buildPanelFiles({
			mode: panelMode,
			working,
			details,
			listComparisonFiles: comparison.files,
			fileView,
		})
	);

	/**
	 * ↑/↓ move the selection, Shift extends it from the anchor, Home/End jump to the edges. While a
	 * diff is open the same keys walk the panel's files instead — the thing on screen is the thing
	 * being browsed — and Alt hands them back to the graph without closing the diff.
	 */
	function navigateByKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		)
			return;
		const listKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
		if (!listKeys.includes(event.key)) return;
		if (diffTarget && !event.altKey && listPanelFiles.length > 0) {
			event.preventDefault();
			const path = stepPath(listPanelFiles, diffTarget.path, event.key, PAGE_JUMP);
			if (path !== null) openPanelFile(path);
			return;
		}
		if (visibleRows.length === 0) return;
		event.preventDefault();

		const fromHash = rangeEnd ?? selectedHash;
		const current = fromHash ? visibleRows.findIndex((row) => row.commit.hash === fromHash) : -1;
		const last = visibleRows.length - 1;
		const next = nextRowIndex(event.key, current, last, PAGE_JUMP);
		const hash = visibleRows[next].commit.hash;
		if (event.shiftKey && selectedHash) selectRangeTo(hash);
		else select(hash);
		scrollTo(hash);
	}

	/** Open a panel file by whichever route the panel's current mode uses. */
	function openPanelFile(path: string): void {
		if (panelMode === 'changes') openWorkingFile(path);
		else if (panelMode === 'commit') openDiff(path);
		else openCompareDiff(path);
	}

	function toggleColumn(column: keyof ColumnVisibility): void {
		columns = { ...columns, [column]: !columns[column] };
	}

	function closeFind(): void {
		findOpen = false;
		findQuery = '';
	}

	onMount(() => {
		const off = onHostMessage((message: HostToWebview) => {
			// A domain that owns this message answers it in its own file; nothing below has to know.
			if (dispatchHostMessage(message)) return;
			switch (message.type) {
				case 'commits': {
					if (!commitsReplyMatches(message, hostFilters(), graphLimit)) break;
					// Another view switched the controller to a different repository. Everything built
					// over the old one — the keyed graph (menus, drag state), dialogs, selection, the
					// open diff — closes now, so no stale payload can be stamped with the new repo.
					if (activeRepo !== null && message.activeRepo !== activeRepo) {
						resetForRepo();
						cleanupOpen = false;
						cleanupInventory = null;
						cleanupResults = null;
						pendingCheckout = null;
						pendingHeadReveal = null;
						listWorkspaceIdentities = [];
						commitGuard = null;
						pendingCommitAwaitIdentity = null;
						// Questions asked over the old repository die with it.
						for (const item of listUiQueue) {
							postToHost({ type: 'uiReply', requestId: item.requestId, cancelled: true });
						}
						listUiQueue = [];
						if (uiRequest) {
							postToHost({ type: 'uiReply', requestId: uiRequest.requestId, cancelled: true });
							uiRequest = null;
						}
						diffTarget = null;
						selectedHash = null;
						listSelected = [];
						rangeEnd = null;
						details = null;
						detailsLoading = false;
						comparison = { fromHash: null, toHash: null, files: [], loading: false };
					}
					const wasFullLoad = status === 'loading';
					rows = layoutCommits(message.commits);
					repoState = message.repoState;
					hasMore = message.hasMore;
					if (wasFullLoad && settings.scrollToHeadOnLoad) {
						const head = message.commits.find((commit) =>
							commit.refs.some((ref) => ref.kind === 'head')
						);
						if (head) scrollTo(head.hash);
					}
					// A squash or rebase rewrites hashes, so a kept range would point at ghosts.
					listSelected = listSelected.filter((hash) =>
						message.commits.some((commit) => commit.hash === hash)
					);
					if (listSelected.length < 2) listSelected = [];
					repoName = message.repoName;
					working = message.working;
					repos = message.repos;
					activeRepo = message.activeRepo;
					currentBranch = message.currentBranch;
					previousBranch = message.previousBranch;
					headHash = message.headHash;
					listBranches = message.listBranches;
					ahead = message.ahead;
					behind = message.behind;
					status = 'ready';
					if (pendingJump) jumpToBranch(pendingJump.branch, pendingJump.pagesLeft - 1);
					if (pendingHeadReveal) showHead(pendingHeadReveal.pagesLeft - 1);
					break;
				}
				case 'statusUpdate': {
					// A working-tree change leaves history alone, so the rows stay as they are — only the
					// uncommitted row's label is rewritten, and the panel beside it re-reads its files.
					working = message.working;
					ahead = message.ahead;
					behind = message.behind;
					repoState = message.repoState;
					currentBranch = message.currentBranch;
					previousBranch = message.previousBranch;
					headHash = message.headHash;
					// Rebuilt only when there is an uncommitted row to relabel: reassigning `rows` is
					// what every graph derivation hangs off, so a no-op update should not touch it.
					if (rows.some((row) => row.commit.isUncommitted)) {
						rows = rows.map((row) =>
							row.commit.isUncommitted
								? {
										...row,
										commit: {
											...row.commit,
											subject: `Uncommitted Changes (${message.changeCount})`,
										},
									}
								: row
						);
					}
					break;
				}
				case 'commitDetails': {
					// A reply for a commit no longer selected is stale — clicking A then B quickly must
					// not show A's details under B's selection when A answers last.
					if (message.details.hash !== selectedHash) break;
					details = message.details;
					detailsLoading = false;
					break;
				}
				case 'comparison': {
					// Same guard: only the comparison currently on screen may take the answer.
					if (message.fromHash !== comparison.fromHash || message.toHash !== comparison.toHash)
						break;
					comparison = {
						fromHash: message.fromHash,
						toHash: message.toHash,
						files: message.files,
						loading: false,
					};
					break;
				}
				case 'fileDiff': {
					if (isCacheableDiffKey(message.key)) {
						mapDiffCache.set(message.key, {
							listHunks: message.listHunks,
							notice: message.notice,
						});
					}
					// A reply for a file the user has already stepped past would otherwise overwrite the
					// one they are looking at now.
					if (message.key === diffKey) {
						diffHunks = message.listHunks;
						diffNotice = message.notice ?? null;
						diffLoading = false;
					}
					break;
				}
				case 'fileIcons': {
					setFileIconTheme(message.theme);
					break;
				}
				case 'colorTheme': {
					themeKind = message.kind;
					break;
				}
				case 'viewSettings': {
					applyPreferences(message.settings);
					break;
				}
				case 'revealCommit': {
					select(message.hash);
					scrollTo(message.hash);
					break;
				}
				case 'fastForwardCheck': {
					fastForward = { nonce: message.nonce, canFastForward: message.canFastForward };
					break;
				}
				case 'identity': {
					repoIdentity = {
						name: message.name,
						email: message.email,
						hasLocalName: message.hasLocalName,
						hasLocalEmail: message.hasLocalEmail,
						listRemoteUrls: message.listRemoteUrls,
						globalName: message.globalName,
						globalEmail: message.globalEmail,
					};
					listIdentities = message.listIdentities;
					if (pendingCommitAwaitIdentity) {
						const pending = pendingCommitAwaitIdentity;
						pendingCommitAwaitIdentity = null;
						if (message.email === pending.email) {
							postCommit(pending.message);
						} else {
							showNotice(
								`The identity switch did not take effect, so nothing was committed. Your message is still in the box.`
							);
						}
					}
					maybeAutoApplyIdentity();
					break;
				}
				case 'workspaceIdentities': {
					listWorkspaceIdentities = message.listRepos;
					break;
				}
				case 'branchInventory': {
					cleanupInventory = {
						listBranches: message.listBranches,
						mergedBase: message.mergedBase,
					};
					break;
				}
				case 'branchCleanupResult': {
					cleanupResults = message.listResults;
					break;
				}
				case 'uiRequest': {
					if (uiRequest) listUiQueue.push(message);
					else uiRequest = message;
					break;
				}
				case 'uiDismiss': {
					// Withdrawn by the host (timeout). No reply — the host already resolved it.
					if (uiRequest?.requestId === message.requestId) {
						uiRequest = listUiQueue.shift() ?? null;
					} else {
						listUiQueue = listUiQueue.filter((item) => item.requestId !== message.requestId);
					}
					break;
				}
				case 'error': {
					// A failed side query is that panel's problem, not the graph's: report it where it
					// was asked for instead of replacing a healthy graph with an error screen.
					if (message.source === 'loadCommitDetails') {
						detailsLoading = false;
						showNotice(message.message);
						break;
					}
					if (message.source === 'loadComparison') {
						comparison = { ...comparison, loading: false };
						showNotice(message.message);
						break;
					}
					if (message.source === 'loadFileDiff') {
						diffLoading = false;
						diffNotice = message.message;
						break;
					}
					errorMessage = message.message;
					repos = message.repos;
					activeRepo = message.activeRepo;
					status = 'error';
					detailsLoading = false;
					break;
				}
				default: {
					// Adding a message to the protocol without handling it here is now a compile error
					// rather than a silent no-op that only shows up as "the view did not react".
					const unhandled: never = message;
					void unhandled;
				}
			}
		});
		// Load with this view's own filters: `ready` alone would make the host fall back to the
		// filters it persisted last session, losing settings such as avatar fetching.
		load();
		return off;
	});

	/**
	 * A load that never answers means the channel to the extension is gone — which is what happens
	 * when the extension is reinstalled or updated under a window that is left open: this view keeps
	 * running against a host that no longer exists, and every message it posts goes nowhere. Nothing
	 * in here can repair that, so after a few seconds it says what will.
	 */
	let stalled = $state(false);
	let stallTimer: ReturnType<typeof setTimeout> | null = null;
	const STALL_MS = 6000;

	/**
	 * Only when there is nothing to look at yet — first load, or a switch to another repository.
	 * A refresh over commits already on screen keeps them: replacing a full graph with placeholder
	 * bars says "gone" when the truth is "being checked", and the rows almost always come back the
	 * same.
	 */
	const showSkeleton = $derived(status === 'loading' && rows.length === 0);

	/** What the last loadCommits was actually asked with, to compare against saved settings. */
	let lastLoadSignature = '';

	function currentLoadSignature(): string {
		return loadSignature(settings.commitLimit, hostFilters());
	}

	function load(): void {
		status = 'loading';
		stalled = false;
		if (stallTimer) clearTimeout(stallTimer);
		stallTimer = setTimeout(() => (stalled = status === 'loading'), STALL_MS);
		if (graphLimit < settings.commitLimit) graphLimit = settings.commitLimit;
		lastLoadSignature = currentLoadSignature();
		postToHost({ type: 'loadCommits', limit: graphLimit, filters: hostFilters() });
		postToHost({ type: 'loadIdentity' });
	}

	/** One more page of history, without tearing the graph down into a loading screen. */
	function loadMore(): void {
		graphLimit += settings.commitLimit;
		lastLoadSignature = currentLoadSignature();
		postToHost({ type: 'loadCommits', limit: graphLimit, filters: hostFilters() });
	}

	function applyIdentity(identity: GitIdentity): void {
		postToHost({
			type: 'identityAction',
			action: 'apply',
			name: identity.name,
			email: identity.email,
		});
	}

	/**
	 * One attempt per repo-and-identity: a successful apply comes back as an identity message that
	 * no longer asks for anything, but a *failed* one comes back unchanged — and without this the
	 * view would retry the same doomed apply on every identity reply, forever.
	 */
	let lastAutoApplyKey = '';

	function maybeAutoApplyIdentity(): void {
		if (!repoIdentity) return;
		const plan = planAutoApply({
			enabled: settings.autoApplyIdentity,
			hasLocalOverride: repoIdentity.hasLocalName || repoIdentity.hasLocalEmail,
			activeEmail: repoIdentity.email,
			listMatched: listMatchedIdentities(listIdentities, repoIdentity.listRemoteUrls),
		});
		if (plan.kind !== 'apply') return;
		const key = `${activeRepo ?? ''}|${plan.identity.email}`;
		if (key === lastAutoApplyKey) return;
		lastAutoApplyKey = key;
		applyIdentity(plan.identity);
		showNotice(`Auto-applied identity "${plan.identity.label}" to this repository.`);
	}

	function clearIdentityOverride(): void {
		postToHost({ type: 'identityAction', action: 'clearOverride' });
	}

	/** Adding from the account dropdown saves the identity and switches to it in one step. */
	function addIdentity(identity: GitIdentity): void {
		addingIdentity = false;
		const next = [...listIdentities, identity];
		listIdentities = next;
		postToHost({
			type: 'identityAction',
			action: 'apply',
			name: identity.name,
			email: identity.email,
			listIdentities: next,
		});
	}

	function saveIdentities(next: GitIdentity[]): void {
		listIdentities = next;
		postToHost({ type: 'saveIdentities', listIdentities: next });
	}

	/** Ctrl/Cmd + click: compare the clicked commit against the selected one. */
	function compareWith(hash: string): void {
		if (!selectedHash || selectedHash === hash) return;
		comparison = { fromHash: selectedHash, toHash: hash, files: [], loading: true };
		postToHost({ type: 'loadComparison', fromHash: selectedHash, toHash: hash });
	}

	function openCompareDiff(path: string): void {
		if (comparison.fromHash && comparison.toHash) {
			const oldPath = comparison.files.find((file) => file.path === path)?.oldPath;
			if (settings.diffTarget === 'panel') {
				showDiff({
					path,
					oldPath,
					fromHash: comparison.fromHash,
					toHash: comparison.toHash,
					title: `${comparison.fromHash.slice(0, 8)} ↔ ${comparison.toHash.slice(0, 8)}`,
				});
				return;
			}
			postToHost({
				type: 'openCompareDiff',
				fromHash: comparison.fromHash,
				toHash: comparison.toHash,
				path,
				oldPath,
			});
		}
	}

	/** Context lines: the whole-file view asks for more than any file could have. */
	const FULL_CONTEXT = 1_000_000;

	function showDiff(target: DiffTargetState): void {
		diffTarget = target;
		requestDiff(target);
	}

	function requestDiff(target: DiffTargetState): void {
		const context = settings.diffMode === 'full' ? FULL_CONTEXT : 3;
		const key = buildDiffKey(target, context);
		diffKey = key;
		const cached = mapDiffCache.get(key);
		if (cached) {
			diffHunks = cached.listHunks;
			diffNotice = cached.notice ?? null;
			diffLoading = false;
			return;
		}
		diffHunks = [];
		diffNotice = null;
		diffLoading = true;
		postToHost({
			type: 'loadFileDiff',
			key,
			path: target.path,
			oldPath: target.oldPath,
			hash: target.hash,
			fromHash: target.fromHash,
			toHash: target.toHash,
			untracked: target.untracked,
			context,
		});
	}

	function setDiffMode(mode: 'compact' | 'full'): void {
		settings = { ...settings, diffMode: mode };
		if (diffTarget) requestDiff(diffTarget);
	}

	function scrollTo(hash: string | null): void {
		if (!hash) return;
		scrollTarget = { hash, nonce: (scrollTarget?.nonce ?? 0) + 1 };
	}

	/** Remote branches are only in the graph when the walk includes them. */
	const listJumpBranches = $derived(
		listBranches.filter((branch) => settings.showRemoteBranches || !branch.remote)
	);

	/** How many extra pages a branch jump may pull in before giving up. */
	const JUMP_PAGES = 3;

	function showNotice(message: string): void {
		notice = message;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 4000);
	}

	/**
	 * Move the view to a branch's commit — the sidebar's reveal, driven from the control bar. The
	 * branch is never checked out, so the pick leaves the repository exactly as it was.
	 *
	 * A tip older than the loaded window is not an error: pull another page and try again, up to
	 * `pagesLeft`, so a branch left behind long ago is still reachable without loading all history.
	 */
	function jumpToBranch(branch: BranchRef, pagesLeft = JUMP_PAGES): void {
		pendingJump = null;
		const row = rows.find((item) => item.commit.hash === branch.hash);
		if (row) {
			// A find query the target does not match would hide the very row being jumped to.
			if (findOpen && !visibleRows.some((item) => item.commit.hash === branch.hash)) closeFind();
			select(branch.hash);
			scrollTo(branch.hash);
			return;
		}
		if (hasMore && pagesLeft > 0) {
			pendingJump = { branch, pagesLeft };
			loadMore();
			return;
		}
		showNotice(`${branch.name} is not in the loaded history.`);
	}

	function selectRepo(path: string): void {
		status = 'loading';
		pendingHeadReveal = null;
		selectedHash = null;
		details = null;
		graphLimit = 0;
		// Another repository's history, so these rows are not a stale view of the answer — they are
		// the wrong answer. Dropping them is also what puts the skeleton back up while it loads.
		rows = [];
		postToHost({ type: 'selectRepo', path });
	}

	function select(hash: string): void {
		selectedHash = hash;
		listSelected = [];
		rangeEnd = null;
		comparison = { fromHash: null, toHash: null, files: [], loading: false };
		if (hash === UNCOMMITTED_HASH) return;
		details = null;
		detailsLoading = true;
		postToHost({ type: 'loadCommitDetails', hash });
	}

	/** Drop the selection so the panel falls back to the working tree. */
	function closeDetails(): void {
		selectedHash = null;
		listSelected = [];
		details = null;
		comparison = { fromHash: null, toHash: null, files: [], loading: false };
	}

	/** Shift-click / Shift+Arrow: select every commit between the anchor and the target. */
	function selectRangeTo(hash: string): void {
		if (!selectedHash) {
			select(hash);
			return;
		}
		rangeEnd = hash;
		const listRange = selectRange(visibleRows, selectedHash, hash);
		listSelected = listRange.length > 1 ? listRange : [];
	}

	function runMulti(
		action: 'squash' | 'drop' | 'cherryPick' | 'revert',
		listHashes: string[]
	): void {
		const listCommits = listHashes
			.map((hash) => rows.find((row) => row.commit.hash === hash)?.commit)
			.filter((commit): commit is Commit => commit !== undefined);
		if (listCommits.length < 2) return;
		const hashes = listCommits.map((commit) => commit.hash);
		const subjects = listCommits.map((commit) => commit.subject);
		if (action === 'squash') {
			postToHost({ type: 'squashCommits', repoPath: activeRepo ?? '', hashes, subjects });
		} else {
			postToHost({
				type: 'multiCommitAction',
				repoPath: activeRepo ?? '',
				action,
				hashes,
				subjects,
			});
		}
	}

	function runSequencer(action: SequencerActionMessage['action']): void {
		postToHost({ type: 'sequencerAction', repoPath: activeRepo ?? '', action });
	}

	/** The three ways out of a detached HEAD, offered by the bar that reports it. */
	function runHeadAction(action: 'checkoutPrevious' | 'createBranch'): void {
		if (!headHash) return;
		postToHost({
			type: 'commitAction',
			repoPath: activeRepo ?? '',
			action,
			hash: headHash,
			subject: '',
			branches: [],
			remoteBranches: [],
			// What the banner was claiming when it was pressed. The host proves both again before
			// it moves HEAD, so a banner left open across a checkout made elsewhere cannot send the
			// user somewhere its own label never named.
			expected:
				action === 'checkoutPrevious' && previousBranch ? { previousBranch, headHash } : undefined,
		});
	}

	/**
	 * Scroll to the commit HEAD is detached at, loading more history until it turns up.
	 *
	 * The banner can name a commit the graph has not walked to yet — the loaded page ends above it
	 * — and selecting a row that is not there would be a button that does nothing. Same paging as
	 * a branch jump, and the same admission when it runs out.
	 */
	function showHead(pagesLeft = JUMP_PAGES): void {
		pendingHeadReveal = null;
		if (!headHash) return;
		const hash = headHash;
		const step = planReveal({
			loaded: rows.some((item) => item.commit.hash === hash),
			hasMore,
			pagesLeft,
		});
		if (step.kind === 'reveal') {
			// A find query the target does not match would hide the very row being revealed.
			if (findOpen && !visibleRows.some((item) => item.commit.hash === hash)) closeFind();
			select(hash);
			scrollTo(hash);
			return;
		}
		if (step.kind === 'loadMore') {
			pendingHeadReveal = { pagesLeft };
			loadMore();
			return;
		}
		showNotice(`${hash.slice(0, 7)} is not in the loaded history.`);
	}

	let pendingCheckout = $state<{ local: string | null; remote: RemoteBranchRef | null } | null>(
		null
	);
	/** Branch name most recently checked out this session — wins the collapsed chip slot. */
	let lastPickedBranch = $state<string | null>(null);

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);

	function checkoutBranch(local: string | null, remote: RemoteBranchRef | null): void {
		// Uncommitted work follows you across a checkout, or blocks it — worth a heads-up first.
		if (changeCount > 0) {
			pendingCheckout = { local, remote };
			return;
		}
		runCheckout(local, remote);
	}

	function runCheckout(local: string | null, remote: RemoteBranchRef | null): void {
		pendingCheckout = null;
		lastPickedBranch = local ?? remote?.branch ?? null;
		postToHost({
			type: 'commitAction',
			repoPath: activeRepo ?? '',
			action: 'checkoutBranch',
			hash: '',
			subject: '',
			branches: local ? [local] : [],
			remoteBranches: remote ? [remote] : [],
		});
	}

	function resizeColumn(column: ColumnKey, width: number): void {
		widths = { ...widths, [column]: width };
	}

	function openDiff(path: string): void {
		if (!selectedHash) return;
		const oldPath = details?.files.find((file) => file.path === path)?.oldPath;
		if (settings.diffTarget === 'panel') {
			showDiff({ path, oldPath, hash: selectedHash, title: selectedHash.slice(0, 8) });
			return;
		}
		postToHost({ type: 'openDiff', hash: selectedHash, path, oldPath });
	}

	function openWorkingFile(path: string): void {
		if (settings.diffTarget === 'panel') {
			const file = [...(working?.staged ?? []), ...(working?.unstaged ?? [])].find(
				(item) => item.path === path
			);
			showDiff({
				path,
				oldPath: file?.oldPath,
				untracked: file?.status === '?',
				title: 'Working Tree',
			});
			return;
		}
		postToHost({ type: 'openWorkingDiff', path });
	}

	function workingAction(action: WorkingTreeAction, path?: string, message?: string): void {
		const plan = planCommitGuard(action, identityWarningFor);
		if (plan.kind === 'ask') {
			commitGuard = { suggested: plan.suggested, message };
			return;
		}
		postToHost({
			type: 'workingTreeAction',
			repoPath: activeRepo ?? '',
			action,
			path,
			message,
		});
	}

	function postCommit(message?: string): void {
		postToHost({
			type: 'workingTreeAction',
			repoPath: activeRepo ?? '',
			action: 'commit',
			message,
		});
	}

	function answerCommitGuard(choice: string): void {
		if (!commitGuard) return;
		const { suggested, message } = commitGuard;
		commitGuard = null;
		if (choice === 'anyway') {
			postCommit(message);
			return;
		}
		pendingCommitAwaitIdentity = { email: suggested.email, message };
		applyIdentity(suggested);
	}

	function openSettings(): void {
		settingsOpen = true;
		postToHost({ type: 'loadWorkspaceIdentities' });
	}

	function runBranchAction(
		action: BranchActionId,
		source: string,
		sourceLabel: string,
		target: string
	): void {
		postToHost({
			type: 'branchAction',
			repoPath: activeRepo ?? '',
			action,
			source,
			sourceLabel,
			target,
		});
	}

	function checkFastForward(source: string, target: string, nonce: number): void {
		postToHost({ type: 'checkFastForward', source, target, nonce });
	}

	/**
	 * Run a commit action, optionally narrowed to one ref.
	 *
	 * Without `target` the payload carries every ref on the commit, which is right for the actions
	 * that are about the commit itself. With one — every action reached from a ref chip or a ref
	 * submenu — the lists hold exactly that ref, so the host never has to ask which one was meant.
	 * The right-click already answered that, and re-asking is where the wrong branch gets deleted.
	 */
	function runAction(action: CommitActionId, commit: Commit, target?: RefTarget): void {
		const stashRef = commit.refs.find((ref) => ref.kind === 'stash');
		const narrowed = target ? buildRefPayload(target) : null;
		postToHost({
			type: 'commitAction',
			repoPath: activeRepo ?? '',
			action,
			hash: commit.hash,
			subject: commit.subject,
			branches:
				narrowed?.listBranches ??
				commit.refs
					.filter((ref) => ref.kind === 'branch' && !ref.remote)
					.map((ref) => (ref.kind === 'branch' ? ref.name : '')),
			remoteBranches:
				narrowed?.listRemoteBranches ??
				commit.refs
					.filter((ref) => ref.kind === 'branch' && ref.remote !== undefined)
					.map((ref) =>
						ref.kind === 'branch' && ref.remote !== undefined
							? { remote: ref.remote, branch: ref.name }
							: { remote: '', branch: '' }
					),
			tags:
				narrowed?.listTags ??
				commit.refs
					.filter((ref) => ref.kind === 'tag')
					.map((ref) => (ref.kind === 'tag' ? ref.name : '')),
			stashName: stashRef?.kind === 'stash' ? stashRef.name : undefined,
		});
	}

	function resizePanel(clientPos: number): void {
		if (!shell) return;
		const box = shell.getBoundingClientRect();
		const ratio = stacked
			? 1 - (clientPos - box.top) / box.height
			: 1 - (clientPos - box.left) / box.width;
		panelRatio = Math.min(0.75, Math.max(0.15, ratio));
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
	{#if uiRequest}
		{@const request = uiRequest}
		{#if request.payload.kind === 'confirm'}
			<ConfirmDialog
				title={request.payload.title}
				message={request.payload.message}
				confirmLabel={request.payload.confirmLabel ?? 'Yes'}
				danger={request.payload.danger ?? false}
				onconfirm={() => replyUi({ requestId: request.requestId, confirmed: true })}
				oncancel={cancelUi}
			/>
		{:else if request.payload.kind === 'pick'}
			<OptionsDialog
				title={request.payload.title}
				listOptions={request.payload.listOptions}
				multi={request.payload.multi ?? false}
				onsubmit={(listSelected) => replyUi({ requestId: request.requestId, listSelected })}
				oncancel={cancelUi}
			/>
		{:else}
			<TextInputDialog
				title={request.payload.title}
				prompt={request.payload.prompt}
				value={request.payload.value}
				multiline={request.payload.multiline ?? false}
				required={request.payload.required ?? false}
				onsubmit={(text) => replyUi({ requestId: request.requestId, text })}
				oncancel={cancelUi}
			/>
		{/if}
	{/if}

	{#if pendingCheckout}
		<!-- The branch is deliberately not named. A remote chip may stand for a local branch that has
		     fallen behind and sits on another row, and only the host can tell — naming the chip here
		     would promise `origin/x` and then check out `x`. -->
		<ConfirmDialog
			title="Check out branch"
			message="You have {changeCount} uncommitted change{changeCount === 1
				? ''
				: 's'}. They will be carried over to the branch you check out, and the checkout will fail if any of them conflict. Continue?"
			confirmLabel="Check out"
			onconfirm={() => runCheckout(pendingCheckout!.local, pendingCheckout!.remote)}
			oncancel={() => (pendingCheckout = null)}
		/>
	{/if}

	{#if commitGuard}
		<OptionsDialog
			title="Committing as {repoIdentity?.email ?? 'no email'}"
			listOptions={[
				{
					id: 'switch',
					label: `Switch to ${commitGuard.suggested.label} (${commitGuard.suggested.email}), then commit`,
					description: 'Writes the identity to this repository, then commits with it.',
				},
				{
					id: 'anyway',
					label: `Commit as ${repoIdentity?.email ?? 'no email'}`,
					description: "This repository's remote suggests a different identity.",
				},
			]}
			onsubmit={(listSelected) => answerCommitGuard(listSelected[0] ?? 'anyway')}
			oncancel={() => (commitGuard = null)}
		/>
	{/if}

	{#if settingsOpen}
		<SettingsWidget
			{settings}
			identity={repoIdentity}
			{listIdentities}
			{listWorkspaceIdentities}
			suggestedIdentity={identityWarningFor}
			onapplyIdentity={applyIdentity}
			onclearIdentityOverride={clearIdentityOverride}
			onsaveIdentities={saveIdentities}
			onchange={(next) => {
				const reload = settingsRequireReload(settings, next);
				if (next.commitLimit !== settings.commitLimit) graphLimit = 0;
				const diffModeChanged = next.diffMode !== settings.diffMode;
				settings = next;
				if (reload) load();
				// The open diff was fetched with the old context count, so it has to be asked for again.
				if (diffModeChanged && diffTarget) requestDiff(diffTarget);
			}}
			onclose={() => (settingsOpen = false)}
		/>
	{/if}

	{#if addingIdentity}
		<IdentityDialog onsave={addIdentity} onclose={() => (addingIdentity = false)} />
	{/if}

	{#if cleanupOpen}
		<BranchCleanupDialog
			listBranches={cleanupInventory?.listBranches ?? []}
			mergedBase={cleanupInventory?.mergedBase ?? null}
			loading={cleanupInventory === null}
			listResults={cleanupResults}
			ondelete={(listNames, force) =>
				postToHost({
					type: 'cleanupBranches',
					repoPath: activeRepo ?? '',
					listNames,
					// The tips as this dialog showed them: the host refuses a branch that moved since.
					mapExpectedTips: Object.fromEntries(
						(cleanupInventory?.listBranches ?? [])
							.filter((branch) => listNames.includes(branch.name))
							.map((branch) => [branch.name, branch.hash])
					),
					force,
				})}
			onclose={() => (cleanupOpen = false)}
		/>
	{/if}

	<div
		class="shell"
		class:stacked
		bind:this={shell}
		bind:clientWidth={shellWidth}
		bind:clientHeight={shellHeight}
	>
		<!--
			The diff covers the whole left side, control bar included: while reviewing a file, the
			repository-wide buttons are not what the eye is looking for.

			It covers rather than replaces. Swapping the two tore the graph down and built it again on
			every close — scroll position back to the top, control bar rebuilt, the lot fading in, which
			is what read as a flash. Underneath, the graph is `inert` so nothing there takes a click, a
			key or the focus while it cannot be seen.
		-->
		<div class="graph-area">
			<div class="graph-stack" inert={diffTarget !== null}>
				<ControlBar
					{repos}
					{activeRepo}
					{repoName}
					loading={showSkeleton}
					listBranches={listJumpBranches}
					{currentBranch}
					{notice}
					onjumpBranch={jumpToBranch}
					commitCount={status === 'ready' ? rows.length : 0}
					{ahead}
					{behind}
					{repoState}
					onselectRepo={selectRepo}
					onrefresh={load}
					onterminal={() => postToHost({ type: 'openTerminal' })}
					onfind={() => (findOpen = true)}
					onfetch={() =>
						postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'fetch' })}
					onpull={() =>
						postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'pull' })}
					onpullOption={(action) =>
						postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action })}
					onpush={() =>
						postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'push' })}
					onpushForce={() =>
						postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'pushForce' })}
					onsequencer={runSequencer}
					{previousBranch}
					{headHash}
					onbackToPreviousBranch={() => runHeadAction('checkoutPrevious')}
					onbranchFromHead={() => runHeadAction('createBranch')}
					onshowHead={() => showHead()}
					onsettings={openSettings}
					{identityLabel}
					{identityWarning}
					{listIdentities}
					activeEmail={repoIdentity?.email ?? null}
					globalIdentity={repoIdentity
						? { name: repoIdentity.globalName, email: repoIdentity.globalEmail }
						: null}
					overridden={repoIdentity?.hasLocalName === true || repoIdentity?.hasLocalEmail === true}
					onuseGlobal={clearIdentityOverride}
					suggestedIdentity={identityWarningFor}
					onapplyIdentity={applyIdentity}
					onaddIdentity={() => (addingIdentity = true)}
					oncleanup={openCleanup}
					onidentity={openSettings}
				/>

				{#if findOpen}
					<FindWidget
						query={findQuery}
						matchCount={visibleRows.length}
						onquery={(next) => (findQuery = next)}
						onclose={closeFind}
					/>
				{/if}

				{#if stalled && status === 'loading'}
					<p class="hint">
						<span class="stalled">
							No answer from the extension. This happens when Git Octopus is updated while this
							window stays open — reload the window (Developer: Reload Window) to reconnect.
						</span>
					</p>
				{/if}

				{#if showSkeleton}
					<GraphSkeleton {columns} {widths} rowDensity={settings.rowDensity} />
				{:else if status === 'error'}
					<p class="error">{errorMessage}</p>
				{:else if visibleRows.length === 0}
					<p class="hint">{findQuery ? 'No matching commits.' : 'No commits found.'}</p>
				{:else}
					<!-- The skeleton it replaces is already this shape, so the graph only has to fade up
					     into place — no crossfade, which would need both in the layout at once. -->
					<div class="graph-slot gg-enter-rise">
						<!-- Keyed by repository: a repo switch remounts the graph, closing its context
						     menus and drag state — stale UI must not survive into another repo. -->
						{#key activeRepo}
							<GraphView
								rows={visibleRows}
								{selectedHash}
								listSelectedHashes={listSelected}
								{currentBranch}
								lastPicked={lastPickedBranch}
								{columns}
								{widths}
								{scrollTarget}
								compareHash={comparison.toHash}
								dateFormat={settings.dateFormat}
								dateType={settings.dateType}
								graphStyle={settings.graphStyle}
								rowDensity={settings.rowDensity}
								highlightHover={settings.highlightBranchOnHover}
								muteMerges={settings.muteMergeCommits}
								showTicketBadge={settings.showTicketBadge}
								showTypeBadge={settings.showTypeBadge}
								{fastForward}
								{hasMore}
								onselect={select}
								onselectRange={selectRangeTo}
								oncompare={compareWith}
								oncheckoutBranch={checkoutBranch}
								onaction={runAction}
								onmulti={runMulti}
								onloadMore={loadMore}
								onbranchAction={runBranchAction}
								oncheckFastForward={checkFastForward}
								ontoggleColumn={toggleColumn}
								onresizeColumn={resizeColumn}
							/>
						{/key}
					</div>
				{/if}
			</div>

			{#if diffTarget}
				<!-- A Svelte transition rather than a CSS class: the closing half has to run while the
				     element is on its way out, and a class cannot animate a node that is already gone. -->
				<div
					class="diff-layer"
					class:leaving={diffClosing}
					in:fly={{ x: 10, duration: motionMs('base') }}
					out:fly={{ x: 10, duration: motionMs('exit') }}
					onintrostart={() => (diffClosing = false)}
					onoutrostart={() => (diffClosing = true)}
				>
					<DiffPanel
						path={diffTarget.path}
						title={diffTarget.title}
						listHunks={diffHunks}
						listLineTokens={listDiffTokens}
						notice={diffNotice}
						loading={diffLoading}
						mode={settings.diffMode}
						onmode={setDiffMode}
						onclose={() => (diffTarget = null)}
					/>
				</div>
			{/if}
		</div>

		<Splitter vertical={stacked} onresize={resizePanel} />

		<div
			class="panel-area"
			style={stacked
				? `height:${Math.round(shellHeight * panelRatio)}px`
				: `width:${Math.round(shellWidth * panelRatio)}px`}
		>
			<ChangesPanel
				mode={panelMode}
				loading={showSkeleton}
				{working}
				{details}
				{detailsLoading}
				branchName={currentBranch}
				{ahead}
				{behind}
				{comparison}
				activePath={diffTarget?.path ?? null}
				onpush={() =>
					postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'push' })}
				onpushForce={() =>
					postToHost({ type: 'repoAction', repoPath: activeRepo ?? '', action: 'pushForce' })}
				{fileView}
				{metaOpen}
				onmetaOpen={(open) => (metaOpen = open)}
				onfileView={(next) => (fileView = next)}
				onclose={closeDetails}
				oncopy={(text) => postToHost({ type: 'copyText', text, label: 'commit hash' })}
				onselectCommit={(hash) => {
					select(hash);
					scrollTo(hash);
				}}
				onworkingAction={workingAction}
				onopenWorkingFile={openWorkingFile}
				onopenDiff={openDiff}
				onopenCompareDiff={openCompareDiff}
				onopenFile={(path, hash) => postToHost({ type: 'openFile', path, hash })}
				oncopyPath={(path, absolute) => postToHost({ type: 'copyFilePath', path, absolute })}
			/>
		</div>
	</div>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.shell {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.shell.stacked {
		flex-direction: column;
	}
	.graph-area {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.graph-stack {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	/* Opaque and edge to edge: the graph stays mounted behind it, it must not show through. */
	.diff-layer.leaving {
		pointer-events: none;
	}
	.diff-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		background: var(--gg-bg);
	}
	/* Only there to carry the enter animation — it hands its whole box to the graph. */
	.graph-slot {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.panel-area {
		flex: none;
		min-width: 0;
		min-height: 0;
	}
	.hint,
	.error {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
	.stalled {
		display: inline-block;
		max-width: 46em;
		margin-top: var(--gg-space-2);
		color: var(--vscode-editorWarning-foreground, #cca700);
	}
	.error {
		color: var(--vscode-errorForeground);
	}
</style>
