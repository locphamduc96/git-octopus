<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import type {
		FileHistoryEntry,
		HiddenRefs,
		SelectedDiffLine,
		WorkingDiffSide,
		BranchActionId,
		GraphFilters,
		BranchRef,
		Commit,
		CommitActionId,
		CommitDetails,
		GraphRow,
		HostToWebview,
		RemoteBranchRef,
		RepoInfo,
		UiRequestMessage,
		RepoState,
		SequencerActionMessage,
		UpstreamTracking,
		WorkingTreeAction,
		WorkingTreeStatus,
		HostCommand,
	} from '@git-octopus/shared';
	import { UNCOMMITTED_HASH } from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost, readState, updateState, STATE_VERSION } from './lib/bridge';
	import {
		buildHostFilters,
		commitsReplyMatches,
		hiddenCount,
		loadSignature,
		NO_HIDDEN_REFS,
	} from './lib/commitsGuard';
	import {
		dispatchHostMessage,
		notifyHostError,
		ownsGraph,
		resetForRepo,
		type RoutedByStore,
	} from './lib/hostRouter';
	import { buildRefPayload, commitRefPayload, commitStashName } from './lib/refPayload';
	import type { MultiAction, RefTarget } from './lib/graphMenu';
	import { nextRowIndex, stepAcrossLanes, stepAlongLane } from './lib/keyNav';
	import { buildPanelFiles, stepPath, type PanelMode } from './lib/panelFiles';
	import {
		branchesPanelShown,
		clampRefPanelWidth,
		moveColumn,
		normalizeColumnOrder,
		pullActionFor,
		settingsRequireReload,
	} from './lib/viewSettings';
	import { buildRefMenu, resolveMenuSelection, type MenuEntry } from './lib/graphMenu';
	import { chipRef, chipRemote, type RefChip } from './lib/graphChips';
	import ContextMenu from './lib/ui/ContextMenu.svelte';
	import RefPanel from './features/ref-panel/RefPanel.svelte';
	import type { RefPanelItem } from './features/ref-panel/refPanelModel';
	import {
		chipForItem,
		commitForItem,
		refPanel,
		toggleHiddenRef,
	} from './lib/stores/refPanel.svelte';
	import ControlBar from './features/control-bar/ControlBar.svelte';
	import DiffPanel from './features/diff/DiffPanel.svelte';
	import FindWidget from './features/find/FindWidget.svelte';
	import { buildMatcher, listMatchHashes, stepMatch } from './lib/findMatch';
	import { fileHistory } from './lib/stores/fileHistory.svelte';
	import { pinnedChain } from './lib/pinnedBranch';
	import { rightRevision } from './lib/diffKey';
	import { isShortcutListKey } from './lib/shortcuts';
	import ShortcutsDialog from './features/shortcuts/ShortcutsDialog.svelte';
	import RebaseEditor from './features/rebase/RebaseEditor.svelte';
	import CherryPickEditor from './features/cherryPick/CherryPickEditor.svelte';
	import { cherryPickEditor } from './lib/stores/cherryPickEditor.svelte';
	import { commitStats } from './lib/stores/commitStats.svelte';
	import { aiCommit } from './lib/stores/aiCommit.svelte';
	import { worktrees } from './lib/stores/worktrees.svelte';
	import { lfs } from './lib/stores/lfs.svelte';
	import { capabilities } from './lib/stores/capabilities.svelte';
	import './lib/stores/hostNotices.svelte';
	import HostNotices from './lib/ui/HostNotices.svelte';
	import { rebaseEditor } from './lib/stores/rebaseEditor.svelte';
	import GraphView from './features/graph/GraphView.svelte';
	import GraphSkeleton from './features/graph/GraphSkeleton.svelte';
	import ChangesPanel, { type ComparisonState } from './features/changes-panel/ChangesPanel.svelte';
	import IdentityDialog from './features/settings/IdentityDialog.svelte';
	import BranchCleanupDialog from './features/branch-cleanup/BranchCleanupDialog.svelte';
	import SettingsWidget from './features/settings/SettingsWidget.svelte';
	import { fontFaceCss } from './lib/fileIcon';
	import { guessThemeKind } from './lib/highlight';
	import { planReveal } from './lib/revealPlan';
	import { selectRange } from './lib/squashRange';
	import { fileIconTheme, setFileIconTheme } from './lib/stores/fileIcons.svelte';
	import { branchCleanup } from './lib/stores/branchCleanup.svelte';
	import { diffView } from './lib/stores/diffView.svelte';
	import { identity, type CommitOptions } from './lib/stores/identity.svelte';
	import { prefs } from './lib/stores/prefs.svelte';
	import { session } from './lib/stores/session.svelte';
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
	let repoState = $state<RepoState | null>(null);
	let hasMore = $state(false);
	/** Grows as the user scrolls past the end; reset when the repo or page size changes. */
	let graphLimit = $state(0);
	let currentBranch = $state<string | null>(null);
	/** A branch is checked out but has no commits yet — an empty graph with nothing wrong. */
	let isUnborn = $state(false);
	/** Only meaningful while `currentBranch` is null: the branch the detached HEAD came from. */
	let previousBranch = $state<string | null>(null);
	let headHash = $state<string | null>(null);
	let listBranches = $state<BranchRef[]>([]);
	/** A branch pick waiting on more history, with the pages of it still worth loading. */
	let pendingJump = $state<{ branch: BranchRef; pagesLeft: number } | null>(null);
	/** The same, for the detached-HEAD banner's "Show commit". */
	let pendingHeadReveal = $state<{ pagesLeft: number } | null>(null);
	const stored = readState();
	// Sizes saved against a different layout are ignored, so a changed default still lands.
	const saved = stored.version === STATE_VERSION ? stored : {};
	let ahead = $state(0);
	let behind = $state(0);
	/** What the Undo button would undo, straight from the host; null while there is nothing. */
	let undoLabel = $state<string | null>(null);
	/** What Redo would put back — the action last undone; null while there is nothing. */
	let redoLabel = $state<string | null>(null);

	/** Repository path → the branch pinned to the left edge there. Kept per window, like the widths. */
	let mapPinned = $state<Record<string, string>>(saved.mapPinned ?? {});
	const pinnedRef = $derived(mapPinned[session.repoPath] ?? null);
	/** Repository path → the refs hidden from the graph there. Kept per window, like the pin. */
	let mapHidden = $state<Record<string, HiddenRefs>>(saved.mapHidden ?? {});
	const hiddenRefs = $derived(mapHidden[session.repoPath] ?? NO_HIDDEN_REFS);

	let shortcutsOpen = $state(false);
	let findOpen = $state(false);
	let findQuery = $state('');
	let findMatchCase = $state(false);
	let findRegex = $state(false);
	let findFilter = $state(false);
	/** The match Enter last landed on; null until the user steps. */
	let findCurrent = $state<string | null>(null);

	let selectedHash = $state<string | null>(null);
	/** Shift-click range selection, in row order; empty unless it spans at least two commits. */
	let listSelected = $state<string[]>([]);
	/** The moving end of a shift-selection — where Shift+Arrow continues from. */
	let rangeEnd = $state<string | null>(null);
	let details = $state<CommitDetails | null>(null);
	let detailsLoading = $state(false);

	let settingsOpen = $state(false);

	$effect(prefs.save);

	/** "Show only these branches", chosen from ref menus. Session-only, never persisted. */
	let listSolo = $state<string[]>([]);

	/** Always read live: the guard compares a reply against what the view wants *now*. */
	function hostFilters(): GraphFilters {
		return buildHostFilters(prefs.settings, listSolo, hiddenRefs);
	}

	/** "Show Only X" — the graph walks X alone; null shows everything again. */
	function setBranchFilter(ref: string | null): void {
		const next = ref === null ? [] : [ref];
		if (next.join('\0') === listSolo.join('\0')) return;
		listSolo = next;
		load();
	}

	function changeSolo(op: 'add' | 'remove', ref: string): void {
		listSolo = op === 'add' ? [...listSolo, ref] : listSolo.filter((item) => item !== ref);
		load();
	}

	function saveHidden(next: HiddenRefs | null): void {
		const nextMap = { ...mapHidden };
		if (next === null || hiddenCount(next) === 0) delete nextMap[session.repoPath];
		else nextMap[session.repoPath] = next;
		mapHidden = nextMap;
		updateState({ mapHidden: nextMap });
		load();
	}

	function hideRefs(refs: HiddenRefs): void {
		const merge = (listOld: string[], listNew: string[]) => [...new Set([...listOld, ...listNew])];
		saveHidden({
			listBranches: merge(hiddenRefs.listBranches, refs.listBranches),
			listRemotes: merge(hiddenRefs.listRemotes, refs.listRemotes),
			listTags: merge(hiddenRefs.listTags, refs.listTags),
		});
	}

	/**
	 * Limit the graph to the checked-out branch and what it is measured against: its upstream, the
	 * repository's main line — the first of main, master, trunk and develop that exists — and that
	 * line's upstream.
	 */
	function showRelated(): void {
		if (!currentBranch) return;
		const setNames = new Set(listBranches.map((branch) => branch.name));
		const mainLine = ['main', 'master', 'trunk', 'develop'].find((name) =>
			listBranches.some((branch) => branch.name === name && !branch.remote)
		);
		const listRelated = [
			currentBranch,
			mapTracking[currentBranch]?.upstream,
			mainLine,
			mainLine ? mapTracking[mainLine]?.upstream : undefined,
		].filter((name): name is string => !!name && setNames.has(name));
		listSolo = [...new Set(listRelated)];
		load();
	}

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

	let comparison = $state<ComparisonState>({
		fromHash: null,
		toHash: null,
		files: [],
		loading: false,
	});
	// The body classes are all there is to go on until the host sends its `colorTheme` message.
	diffView.setThemeKind(guessThemeKind(document.body));

	// The reads here are what decide when the diff is tokenized again; the work itself belongs to
	// the store, but an effect needs a component to live in.
	$effect(() => {
		diffView.tokenize(
			diffView.key,
			diffView.themeKind,
			diffView.target?.path ?? null,
			diffView.listHunks
		);
	});

	let scrollTarget = $state<{ hash: string; nonce: number } | null>(null);
	/** The host's last answer about whether a drop could fast-forward, keyed by the question's nonce. */
	let fastForward = $state<{ nonce: number; canFastForward: boolean } | null>(null);

	/** The right panel follows the graph selection: no tab strip to keep in sync. */
	const panelMode = $derived<PanelMode>(
		fileHistory.current
			? 'history'
			: comparison.fromHash && comparison.toHash
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
		updateState({
			widths: prefs.widths,
			panelRatio,
			refPanelWidth,
			listRefPanelCollapsed,
		});
	});

	const stacked = $derived(shellWidth < STACK_BREAKPOINT);

	/**
	 * Local branch name -> its drift from upstream, for the chips to draw.
	 *
	 * Built from `listBranches` rather than carried on each `Ref`: a branch appears once in the
	 * branch list and once per commit it decorates, and only the first of those is a place the
	 * fact belongs.
	 */
	const mapTracking = $derived.by(() => {
		const map: Record<string, UpstreamTracking | null> = {};
		for (const branch of listBranches)
			if (!branch.remote) map[branch.name] = branch.tracking ?? null;
		return map;
	});

	const findMatcher = $derived(
		findOpen ? buildMatcher(findQuery, { matchCase: findMatchCase, regex: findRegex }) : null
	);
	const listFindMatches = $derived(listMatchHashes(rows, findMatcher));
	const setFindMatches = $derived(new Set(listFindMatches));

	/**
	 * Rows shown in the graph. Find highlights matches in the full graph by default; only the Filter
	 * toggle drops the others, at the price of lanes cut where the hidden commits were.
	 */
	const visibleRows = $derived(
		findOpen && findFilter && findMatcher !== null && !('error' in findMatcher)
			? rows.filter((row) => setFindMatches.has(row.commit.hash))
			: rows
	);

	/** The query and options the graph last scrolled for — a reload alone must not scroll again. */
	let lastFindKey = '';
	// A new query or option starts over: no current match, and the first match at or below the
	// selection is brought into view without being selected.
	$effect(() => {
		const list = listFindMatches;
		const key = `${findQuery}\u0000${String(findMatchCase)}${String(findRegex)}`;
		untrack(() => {
			if (findCurrent !== null && !list.includes(findCurrent)) findCurrent = null;
			if (key === lastFindKey) return;
			lastFindKey = key;
			findCurrent = null;
			const first = stepMatch(
				list,
				null,
				1,
				rows.map((row) => row.commit.hash),
				selectedHash
			);
			if (first !== null) scrollTo(first);
		});
	});

	/** Enter / Shift+Enter in the find box: select the next or previous match and bring it into view. */
	function stepFind(step: 1 | -1): void {
		const next = stepMatch(
			listFindMatches,
			findCurrent,
			step,
			rows.map((row) => row.commit.hash),
			selectedHash
		);
		if (next === null) return;
		findCurrent = next;
		select(next);
		scrollTo(next);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (isShortcutListKey(event) && !isTyping(event)) {
			event.preventDefault();
			shortcutsOpen = true;
			return;
		}
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
			} else if (
				((event.key === 'z' && event.shiftKey) || event.key === 'Z' || event.key === 'y') &&
				redoLabel &&
				!isTyping(event)
			) {
				event.preventDefault();
				postToHost({ type: 'redoAction', repoPath: session.repoPath });
			} else if (event.key === 'z' && !event.shiftKey && undoLabel && !isTyping(event)) {
				// Only outside a text field: inside one, Cmd+Z is the editor's own undo, and taking it
				// would let a keystroke aimed at a half-typed commit message reset a branch instead.
				event.preventDefault();
				postToHost({ type: 'undoAction', repoPath: session.repoPath });
			}
			return;
		}
		navigateByKey(event);
	}

	/** Whether the keystroke landed in something the user is typing into. */
	function isTyping(event: KeyboardEvent): boolean {
		const target = event.target as HTMLElement | null;
		return (
			!!target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		);
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
			fileView: prefs.fileView,
		})
	);

	/**
	 * ↑/↓ move the selection, Shift extends it from the anchor, Home/End jump to the edges. While a
	 * diff is open the same keys walk the panel's files instead — the thing on screen is the thing
	 * being browsed. Alt+↑/↓ walk along the selected commit's branch in either mode, so a diff stays
	 * open while the review moves commit by commit; ←/→ step to the neighbouring lane.
	 */
	function navigateByKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		)
			return;
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			// Along the branch the selected commit is drawn on, whether or not a diff is open: the
			// rows are in date order, so the row below usually belongs to another lane.
			event.preventDefault();
			stepGraph((current) =>
				stepAlongLane(
					visibleRows.map((row) => row.nodeBranch),
					current,
					event.key === 'ArrowDown' ? 1 : -1
				)
			);
			return;
		}
		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !diffView.target) {
			event.preventDefault();
			stepGraph((current) =>
				stepAcrossLanes(
					visibleRows.map((row) => row.nodeColumn),
					current,
					event.key === 'ArrowRight' ? 1 : -1
				)
			);
			return;
		}
		const listKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
		if (!listKeys.includes(event.key)) return;
		const history = fileHistory.current;
		if (diffView.target && panelMode === 'history' && history && history.listEntries.length > 0) {
			event.preventDefault();
			const listEntries = history.listEntries;
			const current = listEntries.findIndex((entry) => entry.hash === history.activeHash);
			const next = nextRowIndex(event.key, current, listEntries.length - 1, PAGE_JUMP);
			if (next !== current) openHistoryEntry(listEntries[next]);
			return;
		}
		if (diffView.target && listPanelFiles.length > 0) {
			event.preventDefault();
			const path = stepPath(listPanelFiles, diffView.target.path, event.key, PAGE_JUMP);
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

	/**
	 * Move the selection to the row `pick` chooses from the current one. A structural step that finds
	 * nothing returns `current` and the selection stays put; with nothing selected it starts at the
	 * first row, as ↑/↓ do.
	 */
	function stepGraph(pick: (current: number) => number): void {
		if (visibleRows.length === 0) return;
		const current = selectedHash
			? visibleRows.findIndex((row) => row.commit.hash === selectedHash)
			: -1;
		const next = current === -1 ? 0 : pick(current);
		const hash = visibleRows[next].commit.hash;
		if (hash === selectedHash) return;
		select(hash);
		scrollTo(hash);
	}

	/** Open a panel file by whichever route the panel's current mode uses. */
	function openPanelFile(path: string): void {
		if (panelMode === 'changes') openWorkingFile(path);
		else if (panelMode === 'commit') openDiff(path);
		else openCompareDiff(path);
	}

	function closeFind(): void {
		findOpen = false;
		findQuery = '';
		findCurrent = null;
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
					if (session.activeRepo !== null && message.activeRepo !== session.activeRepo) {
						resetForRepo();
						// `resetForRepo` reaches the dialogs that live in a store; this one is a flag
						// here, so it has to be closed by name or Settings stays open over a
						// repository it was never built for.
						settingsOpen = false;
						pendingCheckout = null;
						pendingHeadReveal = null;
						// Questions asked over the old repository die with it.
						for (const item of listUiQueue) {
							postToHost({ type: 'uiReply', requestId: item.requestId, cancelled: true });
						}
						listUiQueue = [];
						if (uiRequest) {
							postToHost({ type: 'uiReply', requestId: uiRequest.requestId, cancelled: true });
							uiRequest = null;
						}
						selectedHash = null;
						listSelected = [];
						rangeEnd = null;
						details = null;
						detailsLoading = false;
						comparison = { fromHash: null, toHash: null, files: [], loading: false };
					}
					// Which branches other worktrees hold changes with any refresh; the branch menus
					// offer those worktrees instead of a checkout git would refuse.
					worktrees.load();
					lfs.set(message.lfsPatterns ?? []);
					const wasFullLoad = status === 'loading';
					rows = layoutCommits(message.commits, {
						setPinned: pinnedChain(message.commits, message.listBranches, pinnedRef),
					});
					repoState = message.repoState;
					hasMore = message.hasMore;
					if (wasFullLoad && prefs.settings.scrollToHeadOnLoad) {
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
					session.setActiveRepo(message.activeRepo);
					currentBranch = message.currentBranch;
					isUnborn = message.isUnborn;
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
					isUnborn = message.isUnborn;
					previousBranch = message.previousBranch;
					headHash = message.headHash;
					// A diff or blame drawn from the working tree is out of date the moment it changes —
					// and staging lines from it changes it on purpose.
					if (diffView.target && rightRevision(diffView.target) === null) diffView.refresh();
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
				case 'fileIcons': {
					setFileIconTheme(message.theme);
					break;
				}
				case 'hostCommand': {
					runHostCommand(message.command);
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
				case 'undoState': {
					undoLabel = message.label;
					redoLabel = message.redoLabel ?? null;
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
					// Whatever this error costs the graph, a domain waiting on the failed request has to
					// stop waiting — the reply it was expecting is never coming.
					notifyHostError(message);
					// A failed side query is that panel's problem, not the graph's: report it where it
					// was asked for instead of replacing a healthy graph with an error screen.
					if (message.source === 'loadCommitDetails') {
						detailsLoading = false;
						session.showNotice(message.message);
						break;
					}
					if (message.source === 'loadComparison') {
						comparison = { ...comparison, loading: false };
						session.showNotice(message.message);
						break;
					}
					if (message.source === 'loadFileDiff') {
						diffView.failed(message.message);
						break;
					}
					// Anything that does not own the graph leaves it standing: the toast the host
					// already showed carries the detail, and a notice repeats it where the user is
					// looking. Tearing the view down for a failed copy or a failed settings write cost
					// them the graph over something that never touched it.
					if (!ownsGraph(message.source)) {
						detailsLoading = false;
						session.showNotice(message.message);
						break;
					}
					errorMessage = message.message;
					repos = message.repos;
					session.setActiveRepo(message.activeRepo);
					status = 'error';
					detailsLoading = false;
					break;
				}
				default: {
					// Only a type a store owns reaches here, and it was answered above. Adding one to the
					// protocol without handling it anywhere is still a compile error rather than a silent
					// no-op that only shows up as "the view did not react".
					const routed: RoutedByStore = message.type;
					void routed;
				}
			}
		});
		// The stored settings arrive in answer to this load, so that answer can already be wrong for
		// them. Self-limiting: once the loaded data matches the settings, the signatures agree.
		prefs.onLoaded(() => {
			if (currentLoadSignature() === lastLoadSignature) return;
			graphLimit = 0;
			load();
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

	/** What the last loadCommits was actually asked with, to compare against saved prefs.settings. */
	let lastLoadSignature = '';

	function currentLoadSignature(): string {
		return loadSignature(prefs.settings.commitLimit, hostFilters());
	}

	function load(): void {
		status = 'loading';
		stalled = false;
		if (stallTimer) clearTimeout(stallTimer);
		stallTimer = setTimeout(() => (stalled = status === 'loading'), STALL_MS);
		if (graphLimit < prefs.settings.commitLimit) graphLimit = prefs.settings.commitLimit;
		lastLoadSignature = currentLoadSignature();
		postToHost({ type: 'loadCommits', limit: graphLimit, filters: hostFilters() });
		postToHost({ type: 'loadIdentity' });
	}

	/** One more page of history, without tearing the graph down into a loading screen. */
	function loadMore(): void {
		graphLimit += prefs.settings.commitLimit;
		lastLoadSignature = currentLoadSignature();
		postToHost({ type: 'loadCommits', limit: graphLimit, filters: hostFilters() });
	}

	/** Ctrl/Cmd + click: compare the clicked commit against the selected one. */
	function compareWith(hash: string): void {
		if (!selectedHash || selectedHash === hash) return;
		startComparison(selectedHash, hash);
	}

	/** "Compare with Working Tree" from a commit's menu. */
	function compareWorkingTree(hash: string): void {
		select(hash);
		startComparison(hash, UNCOMMITTED_HASH);
	}

	/**
	 * The working tree is always the right-hand side: the host diffs a commit against the files on
	 * disk, never the other way round, so a Ctrl+click from the Uncommitted row is turned about.
	 */
	function startComparison(first: string, second: string): void {
		const [fromHash, toHash] = first === UNCOMMITTED_HASH ? [second, first] : [first, second];
		comparison = { fromHash, toHash, files: [], loading: true };
		postToHost({ type: 'loadComparison', fromHash, toHash });
	}

	/** Where a diff opens: the panel, unless the user chose the editor and there is one to open. */
	function diffInPanel(): boolean {
		return !capabilities.editorDiff || prefs.settings.diffTarget === 'panel';
	}

	function comparisonTitle(fromHash: string, toHash: string): string {
		return `${fromHash.slice(0, 8)} ↔ ${toHash === UNCOMMITTED_HASH ? 'working tree' : toHash.slice(0, 8)}`;
	}

	function openCompareDiff(path: string): void {
		if (comparison.fromHash && comparison.toHash) {
			const oldPath = comparison.files.find((file) => file.path === path)?.oldPath;
			if (diffInPanel()) {
				diffView.show({
					path,
					oldPath,
					fromHash: comparison.fromHash,
					toHash: comparison.toHash,
					title: comparisonTitle(comparison.fromHash, comparison.toHash),
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

	function scrollTo(hash: string | null): void {
		if (!hash) return;
		scrollTarget = { hash, nonce: (scrollTarget?.nonce ?? 0) + 1 };
	}

	/** Remote branches are only in the graph when the walk includes them. */
	const listJumpBranches = $derived(
		listBranches.filter((branch) => prefs.settings.showRemoteBranches || !branch.remote)
	);

	/** How many extra pages a branch jump may pull in before giving up. */
	const JUMP_PAGES = 3;

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
		session.showNotice(`${branch.name} is not in the loaded history.`);
	}

	function selectRepo(path: string): void {
		status = 'loading';
		pendingHeadReveal = null;
		selectedHash = null;
		details = null;
		graphLimit = 0;
		// Another repository has its own branches; a filter carried across would ask git to walk
		// a ref that may not exist there.
		listSolo = [];
		// Another repository's history, so these rows are not a stale view of the answer — they are
		// the wrong answer. Dropping them is also what puts the skeleton back up while it loads.
		rows = [];
		postToHost({ type: 'selectRepo', path });
	}

	function select(hash: string): void {
		fileHistory.close();
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

	function runMulti(action: MultiAction, listHashes: string[]): void {
		const listCommits = listHashes
			.map((hash) => rows.find((row) => row.commit.hash === hash)?.commit)
			.filter((commit): commit is Commit => commit !== undefined);
		if (listCommits.length < 2) return;
		const hashes = listCommits.map((commit) => commit.hash);
		const subjects = listCommits.map((commit) => commit.subject);
		if (action === 'squash') {
			postToHost({ type: 'squashCommits', repoPath: session.repoPath, hashes, subjects });
		} else if (action === 'cherryPick') {
			cherryPickEditor.open(listCommits, currentBranch);
		} else {
			postToHost({
				type: 'multiCommitAction',
				repoPath: session.repoPath,
				action,
				hashes,
				subjects,
			});
		}
	}

	function runSequencer(action: SequencerActionMessage['action']): void {
		postToHost({ type: 'sequencerAction', repoPath: session.repoPath, action });
	}

	/** The three ways out of a detached HEAD, offered by the bar that reports it. */
	function runHeadAction(action: 'checkoutPrevious' | 'createBranch'): void {
		if (!headHash) return;
		postToHost({
			type: 'commitAction',
			repoPath: session.repoPath,
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
		session.showNotice(`${hash.slice(0, 7)} is not in the loaded history.`);
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
			repoPath: session.repoPath,
			action: 'checkoutBranch',
			hash: '',
			subject: '',
			branches: local ? [local] : [],
			remoteBranches: remote ? [remote] : [],
		});
	}

	function openDiff(path: string): void {
		if (!selectedHash) return;
		const entry = details?.files.find((file) => file.path === path);
		// A stash's untracked file is diffed in the parent that holds it.
		const hash = entry?.revision ?? selectedHash;
		if (diffInPanel()) {
			diffView.show({ path, oldPath: entry?.oldPath, hash, title: selectedHash.slice(0, 8) });
			return;
		}
		postToHost({ type: 'openDiff', hash, path, oldPath: entry?.oldPath });
	}

	/**
	 * A working-tree file opens on one part of its change: the unstaged part (index → disk) from the
	 * upper sections, the staged part (HEAD → index) from Staged Changes — the part a line picked in
	 * the diff can then be staged or unstaged from. Without a side it is the part the file is listed
	 * under, unstaged first.
	 */
	function openWorkingFile(path: string, side?: WorkingDiffSide): void {
		if (diffInPanel()) {
			const unstagedFile = working?.unstaged.find((item) => item.path === path);
			const stagedFile = working?.staged.find((item) => item.path === path);
			const resolved: WorkingDiffSide = side ?? (unstagedFile ? 'unstaged' : 'staged');
			const file = resolved === 'staged' ? stagedFile : unstagedFile;
			const untracked = file?.status === '?';
			diffView.show({
				path,
				oldPath: file?.oldPath,
				untracked,
				...(untracked ? {} : { side: resolved }),
				title: resolved === 'staged' ? 'Staged' : 'Working Tree',
			});
			return;
		}
		postToHost({ type: 'openWorkingDiff', path });
	}

	function workingAction(
		action: WorkingTreeAction,
		path?: string,
		message?: string,
		options: CommitOptions = {}
	): void {
		if (identity.askBeforeCommit(action, message, options)) return;
		postToHost({
			type: 'workingTreeAction',
			repoPath: session.repoPath,
			action,
			path,
			message,
			...options,
		});
	}

	/**
	 * Which part of a working-tree file the open diff shows, when its lines can be moved: only a
	 * modified file — an added, deleted or renamed one is staged whole, which its row already does.
	 */
	const diffStaging = $derived.by<WorkingDiffSide | null>(() => {
		const target = diffView.target;
		if (!target?.side || target.blame) return null;
		const listFiles = target.side === 'staged' ? working?.staged : working?.unstaged;
		return listFiles?.find((file) => file.path === target.path)?.status === 'M'
			? target.side
			: null;
	});

	function stageLines(
		action: 'stage' | 'unstage' | 'discard',
		listLines: SelectedDiffLine[]
	): void {
		const target = diffView.target;
		if (!target?.side) return;
		postToHost({
			type: 'stageLines',
			repoPath: session.repoPath,
			path: target.path,
			side: target.side,
			action,
			listLines,
		});
	}

	/** The panel lists the commits that touched `path`, walking from `rev` or from HEAD. */
	function openFileHistory(path: string, rev: string | null): void {
		fileHistory.open(path, rev);
	}

	function openBlame(path: string, rev: string | null): void {
		diffView.show({
			path,
			...(rev ? { hash: rev } : {}),
			title: rev ? rev.slice(0, 8) : 'Working Tree',
			blame: true,
		});
	}

	/**
	 * A history entry opens the file as that commit left it — under the name it had then. Blame stays
	 * on if it was on, so walking the history can read who wrote what at each step.
	 */
	function openHistoryEntry(entry: FileHistoryEntry): void {
		fileHistory.setActive(entry.hash);
		diffView.show({
			path: entry.path,
			oldPath: entry.oldPath,
			hash: entry.hash,
			title: entry.hash.slice(0, 8),
			blame: diffView.target?.blame ?? false,
		});
	}

	/**
	 * Pin a branch to the left edge, or unpin with null. Laid out again on the spot from the commits
	 * already loaded: which column a line takes is the view's business, not the host's.
	 */
	function setPinned(ref: string | null): void {
		const next = { ...mapPinned };
		if (ref === null) delete next[session.repoPath];
		else next[session.repoPath] = ref;
		mapPinned = next;
		updateState({ mapPinned: next });
		const listCommits = rows.map((row) => row.commit);
		rows = layoutCommits(listCommits, { setPinned: pinnedChain(listCommits, listBranches, ref) });
	}

	function jumpToPinned(): void {
		const tip = listBranches.find((branch) => branch.name === pinnedRef)?.hash;
		if (tip) scrollTo(tip);
	}

	/** Bring a commit forward in the graph — when it is one of the commits loaded. */
	function revealCommit(hash: string): void {
		if (!rows.some((row) => row.commit.hash === hash)) {
			session.showNotice(`${hash.slice(0, 8)} is not among the commits loaded in the graph.`);
			return;
		}
		select(hash);
		scrollTo(hash);
	}

	function restoreFile(path: string, hash: string): void {
		postToHost({
			type: 'workingTreeAction',
			repoPath: session.repoPath,
			action: 'restoreFromCommit',
			path,
			hash,
		});
	}

	function applyFromStash(path: string, hash: string): void {
		postToHost({
			type: 'workingTreeAction',
			repoPath: session.repoPath,
			action: 'applyFromStash',
			path,
			hash,
		});
	}

	function openSettings(): void {
		settingsOpen = true;
		identity.loadWorkspaceIdentities();
	}

	function runBranchAction(
		action: BranchActionId,
		source: string,
		sourceLabel: string,
		target: string,
		targetRemote?: string
	): void {
		postToHost({
			type: 'branchAction',
			repoPath: session.repoPath,
			action,
			source,
			sourceLabel,
			target,
			...(targetRemote ? { targetRemote } : {}),
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
		// A target means the user clicked one ref and the action is about that ref alone; without
		// one the action is about the commit, so every ref it carries goes along.
		const payload = target ? buildRefPayload(target) : commitRefPayload(commit);
		postToHost({
			type: 'commitAction',
			repoPath: session.repoPath,
			action,
			hash: commit.hash,
			subject: commit.subject,
			branches: payload.listBranches,
			remoteBranches: payload.listRemoteBranches,
			tags: payload.listTags,
			stashName: commitStashName(commit),
		});
	}

	/**
	 * A graph keybinding VS Code resolved for this view: Mod+B branches from the selected commit
	 * (HEAD when nothing real is selected), Mod+L fetches.
	 */
	function runHostCommand(command: HostCommand): void {
		if (command === 'fetch') {
			postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'fetch' });
			return;
		}
		if (command === 'refresh') {
			load();
			return;
		}
		if (command === 'openSettings') {
			settingsOpen = true;
			return;
		}
		const selected = rows.find((row) => row.commit.hash === selectedHash)?.commit;
		if (selected && !selected.isUncommitted) runAction('createBranch', selected);
		else runHeadAction('createBranch');
	}

	// A view that opens already focused fires no focus event; it says so once on load.
	$effect(() => {
		if (document.hasFocus()) postToHost({ type: 'viewFocus', focused: true });
	});

	const refPanelOn = $derived(branchesPanelShown(prefs.settings, capabilities.desktop) && !stacked);
	const refPanelData = $derived(refPanel.repoPath === session.repoPath ? refPanel.data : null);
	const listSubmodules = $derived(repos.filter((repo) => repo.parent === session.repoPath));
	let refPanelWidth = $state(clampRefPanelWidth(saved.refPanelWidth));
	let listRefPanelCollapsed = $state<string[]>(
		Array.isArray(saved.listRefPanelCollapsed)
			? saved.listRefPanelCollapsed.filter((key) => typeof key === 'string')
			: []
	);
	let refMenu = $state<{
		x: number;
		y: number;
		chip: RefChip;
		commit: Commit;
		repoPath: string;
	} | null>(null);

	$effect(() => {
		if (refMenu && refMenu.repoPath !== session.repoPath) refMenu = null;
	});

	// The host answers once a repository is active, and again after every graph reload.
	$effect(() => {
		if (refPanelOn && session.activeRepo !== null) postToHost({ type: 'loadRefPanel' });
	});

	function resizeRefPanel(clientX: number): void {
		if (!shell) return;
		refPanelWidth = clampRefPanelWidth(clientX - shell.getBoundingClientRect().left);
	}

	function loadedCommit(item: RefPanelItem): Commit | undefined {
		return item.hash ? rows.find((row) => row.commit.hash === item.hash)?.commit : undefined;
	}

	function selectRefItem(item: RefPanelItem): void {
		if (item.hash) revealCommit(item.hash);
	}

	function activateRefItem(item: RefPanelItem): void {
		if (item.kind === 'local') {
			if (!item.current) checkoutBranch(item.name, null);
		} else if (item.kind === 'remote' && refPanelData) {
			const chip = chipForItem(item, refPanelData, {});
			if (!chip) return;
			checkoutBranch(null, chipRemote(chip));
		} else if (item.kind === 'worktree') {
			if (!item.current) worktrees.open(item.name);
		} else if (item.kind === 'submodule') {
			selectRepo(item.name);
		}
	}

	function openRefItemMenu(item: RefPanelItem, event: MouseEvent): void {
		event.preventDefault();
		if (!refPanelData) return;
		const chip = chipForItem(item, refPanelData, mapTracking);
		if (!chip) return;
		refMenu = {
			x: event.clientX,
			y: event.clientY,
			chip,
			commit: commitForItem(item, loadedCommit(item)),
			repoPath: session.repoPath,
		};
	}

	const refMenuBuild = $derived(
		refMenu
			? buildRefMenu(refMenu.chip, currentBranch, {
					pinnedRef,
					listSolo,
					mapWorktrees: worktrees.mapElsewhere,
				})
			: { items: [], mapEntries: {} }
	);

	function runRefMenuEntry(entry: MenuEntry, commit: Commit): void {
		switch (entry.type) {
			case 'filter':
				setBranchFilter(entry.ref);
				return;
			case 'pin':
				setPinned(entry.ref);
				return;
			case 'solo':
				changeSolo(entry.op, entry.ref);
				return;
			case 'hide':
				hideRefs(entry.refs);
				return;
			case 'related':
				showRelated();
				return;
			case 'explain':
				aiCommit.explain(entry.target);
				return;
			case 'worktree':
				if (entry.op === 'open') worktrees.open(entry.path);
				else worktrees.add(entry.branch);
				return;
			case 'commit':
				runAction(entry.action, commit, entry.target);
				return;
			case 'branch': {
				const source = chipRef(entry.target.chip);
				if (source) runBranchAction(entry.action, source.ref, source.label, entry.onto);
				return;
			}
			default:
				return;
		}
	}

	function onRefMenuSelect(id: string): void {
		const open = refMenu;
		const build = refMenuBuild;
		refMenu = null;
		const selected = resolveMenuSelection(build.items, id);
		const entry = build.mapEntries[id];
		if (!open || open.repoPath !== session.repoPath || !selected || !entry) return;
		runRefMenuEntry(entry, open.commit);
	}

	/**
	 * The press that began on a splitter. Grabbing the panel's edge to resize it can start a native
	 * drag of the row beside it, which would end the resize after one step.
	 */
	let edgeGrab = false;
	/** The ref dragged out of the panel; the graph reads it to take the drop on a chip. */
	let panelDrag = $state<{ ref: string; label: string; local: boolean } | null>(null);

	function dragRefItem(item: RefPanelItem, event: DragEvent): void {
		const chip = refPanelData ? chipForItem(item, refPanelData, mapTracking) : null;
		const source = chip && chipRef(chip);
		if (!source || edgeGrab) {
			event.preventDefault();
			return;
		}
		panelDrag = { ...source, local: chip.hasLocal };
		window.addEventListener('dragend', endPanelDrag, { once: true });
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'copy';
			event.dataTransfer.setData('text/plain', source.label);
		}
	}

	function endPanelDrag(): void {
		panelDrag = null;
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

<svelte:window
	onmousedowncapture={(event) =>
		(edgeGrab = event.target instanceof Element && event.target.closest('.splitter') !== null)}
	onkeydown={onKeydown}
	onfocus={() => postToHost({ type: 'viewFocus', focused: true })}
	onblur={() => postToHost({ type: 'viewFocus', focused: false })}
/>

{#if shortcutsOpen}
	<ShortcutsDialog onclose={() => (shortcutsOpen = false)} />
{/if}

<RebaseEditor />
<CherryPickEditor />

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

	{#if identity.commitGuard}
		{@const guard = identity.commitGuard}
		<OptionsDialog
			title="Committing as {identity.current?.email ?? 'no email'}"
			listOptions={[
				{
					id: 'switch',
					label: `Switch to ${guard.suggested.label} (${guard.suggested.email}), then commit`,
					description: 'Writes the identity to this repository, then commits with it.',
				},
				{
					id: 'anyway',
					label: `Commit as ${identity.current?.email ?? 'no email'}`,
					description: "This repository's remote suggests a different identity.",
				},
			]}
			onsubmit={(listSelected) => identity.answerCommitGuard(listSelected[0] ?? 'anyway')}
			oncancel={identity.dismissCommitGuard}
		/>
	{/if}

	{#if settingsOpen}
		<SettingsWidget
			settings={prefs.settings}
			identity={identity.current}
			listIdentities={identity.listIdentities}
			listWorkspaceIdentities={identity.listWorkspaceIdentities}
			suggestedIdentity={identity.warningFor}
			onapplyIdentity={identity.apply}
			onclearIdentityOverride={identity.clearOverride}
			onsaveIdentities={identity.save}
			onchange={(next) => {
				const reload = settingsRequireReload(prefs.settings, next);
				if (next.commitLimit !== prefs.settings.commitLimit) graphLimit = 0;
				const diffModeChanged = next.diffMode !== prefs.settings.diffMode;
				prefs.setSettings(next);
				// Saved here rather than by the effect: the host answers every load with the settings
				// it holds, and a load that reached it before this save would put the old values back.
				prefs.save();
				if (reload) load();
				// The open diff was fetched with the old context count, so it has to be asked for again.
				if (diffModeChanged) diffView.refresh();
			}}
			onclose={() => (settingsOpen = false)}
		/>
	{/if}

	{#if identity.adding}
		<IdentityDialog onsave={identity.add} onclose={identity.closeAdd} />
	{/if}

	{#if branchCleanup.open}
		<BranchCleanupDialog
			listBranches={branchCleanup.listBranches}
			mergedBase={branchCleanup.mergedBase}
			loading={branchCleanup.loading}
			listResults={branchCleanup.listResults}
			ondelete={branchCleanup.deleteBranches}
			onclose={branchCleanup.close}
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
		{#if refPanelOn}
			<div class="ref-area" style="width:{refPanelWidth}px">
				{#if refPanelData}
					<RefPanel
						data={refPanelData}
						listWorktrees={worktrees.list ?? []}
						{listSubmodules}
						hidden={hiddenRefs}
						listCollapsed={listRefPanelCollapsed}
						oncollapsechange={(next) => (listRefPanelCollapsed = next)}
						onselect={selectRefItem}
						onactivate={activateRefItem}
						oncontextmenu={openRefItemMenu}
						ondragstart={dragRefItem}
						ontogglehidden={(item) => saveHidden(toggleHiddenRef(item, hiddenRefs))}
					/>
				{/if}
			</div>
			<Splitter onresize={resizeRefPanel} />
		{/if}

		<div class="graph-area">
			<div class="graph-stack" inert={diffView.target !== null}>
				<ControlBar
					{repos}
					activeRepo={session.activeRepo}
					{repoName}
					loading={showSkeleton}
					listBranches={listJumpBranches}
					{currentBranch}
					notice={session.notice}
					{listSolo}
					hiddenCount={hiddenCount(hiddenRefs)}
					onclearFilter={() => setBranchFilter(null)}
					onshowHidden={() => saveHidden(null)}
					onjumpBranch={jumpToBranch}
					commitCount={status === 'ready' ? rows.length : 0}
					{ahead}
					{behind}
					{repoState}
					onselectRepo={selectRepo}
					onrefresh={load}
					{undoLabel}
					{redoLabel}
					onundo={() => postToHost({ type: 'undoAction', repoPath: session.repoPath })}
					onredo={() => postToHost({ type: 'redoAction', repoPath: session.repoPath })}
					onterminal={() => postToHost({ type: 'openTerminal' })}
					onfind={() => (findOpen = true)}
					onfetch={() =>
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'fetch' })}
					onpull={() =>
						postToHost({
							type: 'repoAction',
							repoPath: session.repoPath,
							action: pullActionFor(prefs.settings.pullStrategy),
						})}
					onpullOption={(action) =>
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action })}
					onpush={() =>
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'push' })}
					onpushForce={() =>
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'pushForce' })}
					onsequencer={runSequencer}
					{previousBranch}
					{headHash}
					onbackToPreviousBranch={() => runHeadAction('checkoutPrevious')}
					onbranchFromHead={() => runHeadAction('createBranch')}
					onshowHead={() => showHead()}
					onsettings={openSettings}
					identityLabel={identity.label}
					identityInitials={identity.initials}
					identityLine={identity.line}
					identityWarning={identity.warning}
					listIdentities={identity.listIdentities}
					activeEmail={identity.current?.email ?? null}
					globalIdentity={identity.globalIdentity}
					overridden={identity.overridden}
					onuseGlobal={identity.clearOverride}
					suggestedIdentity={identity.warningFor}
					onapplyIdentity={identity.apply}
					onaddIdentity={identity.openAdd}
					oncleanup={branchCleanup.openDialog}
					onidentity={openSettings}
				/>

				{#if findOpen}
					<FindWidget
						query={findQuery}
						matchCount={listFindMatches.length}
						currentIndex={findCurrent === null ? -1 : listFindMatches.indexOf(findCurrent)}
						error={findMatcher !== null && 'error' in findMatcher ? findMatcher.error : null}
						partial={hasMore}
						matchCase={findMatchCase}
						regex={findRegex}
						filter={findFilter}
						onquery={(next) => (findQuery = next)}
						onstep={stepFind}
						onmatchCase={() => (findMatchCase = !findMatchCase)}
						onregex={() => (findRegex = !findRegex)}
						onfilter={() => (findFilter = !findFilter)}
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
					<GraphSkeleton
						columns={prefs.columns}
						widths={prefs.widths}
						rowDensity={prefs.settings.rowDensity}
					/>
				{:else if status === 'error'}
					<p class="error">{errorMessage}</p>
				{:else if visibleRows.length === 0}
					<p class="hint">
						{#if findQuery}
							No matching commits.
						{:else if isUnborn}
							No commits yet — make the first commit.
						{:else}
							No commits found.
						{/if}
					</p>
				{:else}
					<!-- The skeleton it replaces is already this shape, so the graph only has to fade up
					     into place — no crossfade, which would need both in the layout at once. -->
					<div class="graph-slot gg-enter-rise">
						<!-- Keyed by repository: a repo switch remounts the graph, closing its context
						     menus and drag state — stale UI must not survive into another repo. -->
						{#key session.activeRepo}
							<GraphView
								rows={visibleRows}
								{selectedHash}
								setFindMatches={findFilter ? undefined : setFindMatches}
								{pinnedRef}
								{listSolo}
								columnOrder={prefs.settings.columnOrder}
								onreorderColumn={(from, to) =>
									prefs.setSettings({
										...prefs.settings,
										columnOrder: moveColumn(
											normalizeColumnOrder(prefs.settings.columnOrder),
											from,
											to
										),
									})}
								onpin={setPinned}
								onsolo={changeSolo}
								onhide={hideRefs}
								onrelated={showRelated}
								oninteractiveRebase={rebaseEditor.open}
								onexplain={aiCommit.explain}
								mapWorktrees={worktrees.mapElsewhere}
								onworktree={(op, value) =>
									op === 'open' ? worktrees.open(value) : worktrees.add(value)}
								oninteractiveRebaseOnto={rebaseEditor.openOnto}
								mapCommitStats={commitStats.map}
								externalDrag={panelDrag}
								onexternalDragEnd={endPanelDrag}
								onneedStats={commitStats.request}
								onjumpPinned={jumpToPinned}
								{findCurrent}
								listSelectedHashes={listSelected}
								{currentBranch}
								lastPicked={lastPickedBranch}
								columns={prefs.columns}
								widths={prefs.widths}
								{scrollTarget}
								compareHash={comparison.toHash}
								dateType={prefs.settings.dateType}
								graphStyle={prefs.settings.graphStyle}
								rowDensity={prefs.settings.rowDensity}
								highlightHover={prefs.settings.highlightBranchOnHover}
								muteMerges={prefs.settings.muteMergeCommits}
								showTicketBadge={prefs.settings.showTicketBadge}
								showTypeBadge={prefs.settings.showTypeBadge}
								showTracking={prefs.settings.showTrackingBadges}
								{mapTracking}
								showGhostBranch={prefs.settings.showGhostBranch}
								{fastForward}
								{hasMore}
								onselect={select}
								onselectRange={selectRangeTo}
								oncompare={compareWith}
								oncompareWorking={compareWorkingTree}
								oncheckoutBranch={checkoutBranch}
								onaction={runAction}
								onmulti={runMulti}
								{headHash}
								onloadMore={loadMore}
								onbranchAction={runBranchAction}
								onfilterBranch={setBranchFilter}
								oncheckFastForward={checkFastForward}
								ontoggleColumn={prefs.toggleColumn}
								onresizeColumn={prefs.resizeColumn}
							/>
						{/key}
					</div>
				{/if}
			</div>

			{#if diffView.target}
				{@const open = diffView.target}
				<!-- A Svelte transition rather than a CSS class: the closing half has to run while the
				     element is on its way out, and a class cannot animate a node that is already gone. -->
				<div
					class="diff-layer"
					class:leaving={diffView.closing}
					in:fly={{ x: 10, duration: motionMs('base') }}
					out:fly={{ x: 10, duration: motionMs('exit') }}
					onintrostart={() => diffView.setClosing(false)}
					onoutrostart={() => diffView.setClosing(true)}
				>
					<DiffPanel
						path={open.path}
						title={open.blame ? `Blame · ${open.title}` : open.title}
						listHunks={diffView.listHunks}
						listLineTokens={diffView.listTokens}
						notice={diffView.notice}
						loading={diffView.loading}
						mode={prefs.settings.diffMode}
						layout={prefs.settings.diffLayout}
						wrap={prefs.settings.diffWrap}
						ignoreWhitespace={prefs.settings.diffIgnoreWhitespace}
						intraline={prefs.settings.diffIntraline}
						tabSize={diffView.tabSize}
						image={diffView.image}
						lfs={diffView.lfs}
						submodule={diffView.submodule}
						onopenSubmodule={selectRepo}
						onmode={diffView.setMode}
						onlayout={diffView.setLayout}
						onwrap={diffView.toggleWrap}
						onwhitespace={diffView.toggleIgnoreWhitespace}
						blame={diffView.blame}
						canTrace={rightRevision(open) !== undefined}
						onblame={diffView.toggleBlame}
						onhistory={() => {
							const rev = rightRevision(open);
							if (rev !== undefined) openFileHistory(open.path, rev);
						}}
						onrevealCommit={revealCommit}
						staging={diffStaging}
						onstageLines={stageLines}
						onclose={diffView.close}
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
				{ahead}
				{comparison}
				activePath={diffView.target?.path ?? null}
				onpush={() =>
					postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'push' })}
				onpushForce={() =>
					postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'pushForce' })}
				fileView={prefs.fileView}
				metaOpen={prefs.metaOpen}
				onmetaOpen={prefs.setMetaOpen}
				onfileView={prefs.setFileView}
				onclose={panelMode === 'history' ? fileHistory.close : closeDetails}
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
				onrestoreFile={restoreFile}
				onapplyFromStash={applyFromStash}
				history={fileHistory.current}
				onfileHistory={openFileHistory}
				onblame={openBlame}
				onhistoryOpen={openHistoryEntry}
				onhistoryReveal={revealCommit}
				oncopyPath={(path, absolute) => postToHost({ type: 'copyFilePath', path, absolute })}
			/>
		</div>
	</div>
</div>

{#if refMenu}
	<ContextMenu
		x={refMenu.x}
		y={refMenu.y}
		items={refMenuBuild.items}
		onselect={onRefMenuSelect}
		onclose={() => (refMenu = null)}
	/>
{/if}

<HostNotices />

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
	.ref-area {
		flex: none;
		min-width: 0;
		min-height: 0;
		display: flex;
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
		color: var(--gg-warning);
	}
	.error {
		color: var(--gg-danger);
	}
</style>
