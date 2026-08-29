<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import type {
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
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import { UNCOMMITTED_HASH } from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost, readState, updateState, STATE_VERSION } from './lib/bridge';
	import { buildHostFilters, commitsReplyMatches, loadSignature } from './lib/commitsGuard';
	import {
		dispatchHostMessage,
		notifyHostError,
		ownsGraph,
		resetForRepo,
		type RoutedByStore,
	} from './lib/hostRouter';
	import { buildRefPayload, commitRefPayload, commitStashName } from './lib/refPayload';
	import type { RefTarget } from './lib/graphMenu';
	import { nextRowIndex } from './lib/keyNav';
	import { buildPanelFiles, stepPath } from './lib/panelFiles';
	import { settingsRequireReload } from './lib/viewSettings';
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
	import { fontFaceCss } from './lib/fileIcon';
	import { guessThemeKind } from './lib/highlight';
	import { planReveal } from './lib/revealPlan';
	import { selectRange } from './lib/squashRange';
	import { fileIconTheme, setFileIconTheme } from './lib/stores/fileIcons.svelte';
	import { branchCleanup } from './lib/stores/branchCleanup.svelte';
	import { diffView } from './lib/stores/diffView.svelte';
	import { identity } from './lib/stores/identity.svelte';
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

	let findOpen = $state(false);
	let findQuery = $state('');

	let selectedHash = $state<string | null>(null);
	/** Shift-click range selection, in row order; empty unless it spans at least two commits. */
	let listSelected = $state<string[]>([]);
	/** The moving end of a shift-selection — where Shift+Arrow continues from. */
	let rangeEnd = $state<string | null>(null);
	let details = $state<CommitDetails | null>(null);
	let detailsLoading = $state(false);

	let settingsOpen = $state(false);

	$effect(prefs.save);

	/** "Show only this branch", chosen from a ref menu. Session-only, never persisted. */
	let filterBranch = $state<string | null>(null);

	/** Always read live: the guard compares a reply against what the view wants *now*. */
	function hostFilters(): GraphFilters {
		return buildHostFilters(prefs.settings, filterBranch);
	}

	function setBranchFilter(ref: string | null): void {
		if (filterBranch === ref) return;
		filterBranch = ref;
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
		updateState({ widths: prefs.widths, panelRatio });
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
			fileView: prefs.fileView,
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
		if (diffView.target && !event.altKey && listPanelFiles.length > 0) {
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

	/** Open a panel file by whichever route the panel's current mode uses. */
	function openPanelFile(path: string): void {
		if (panelMode === 'changes') openWorkingFile(path);
		else if (panelMode === 'commit') openDiff(path);
		else openCompareDiff(path);
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
					if (session.activeRepo !== null && message.activeRepo !== session.activeRepo) {
						resetForRepo();
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
					const wasFullLoad = status === 'loading';
					rows = layoutCommits(message.commits);
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
				case 'fileIcons': {
					setFileIconTheme(message.theme);
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
		comparison = { fromHash: selectedHash, toHash: hash, files: [], loading: true };
		postToHost({ type: 'loadComparison', fromHash: selectedHash, toHash: hash });
	}

	function openCompareDiff(path: string): void {
		if (comparison.fromHash && comparison.toHash) {
			const oldPath = comparison.files.find((file) => file.path === path)?.oldPath;
			if (prefs.settings.diffTarget === 'panel') {
				diffView.show({
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
		filterBranch = null;
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
			postToHost({ type: 'squashCommits', repoPath: session.repoPath, hashes, subjects });
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
		const oldPath = details?.files.find((file) => file.path === path)?.oldPath;
		if (prefs.settings.diffTarget === 'panel') {
			diffView.show({ path, oldPath, hash: selectedHash, title: selectedHash.slice(0, 8) });
			return;
		}
		postToHost({ type: 'openDiff', hash: selectedHash, path, oldPath });
	}

	function openWorkingFile(path: string): void {
		if (prefs.settings.diffTarget === 'panel') {
			const file = [...(working?.staged ?? []), ...(working?.unstaged ?? [])].find(
				(item) => item.path === path
			);
			diffView.show({
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
		if (identity.askBeforeCommit(action, message)) return;
		postToHost({
			type: 'workingTreeAction',
			repoPath: session.repoPath,
			action,
			path,
			message,
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
		target: string
	): void {
		postToHost({
			type: 'branchAction',
			repoPath: session.repoPath,
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
					{filterBranch}
					onclearFilter={() => setBranchFilter(null)}
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
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'fetch' })}
					onpull={() =>
						postToHost({ type: 'repoAction', repoPath: session.repoPath, action: 'pull' })}
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
					<GraphSkeleton
						columns={prefs.columns}
						widths={prefs.widths}
						rowDensity={prefs.settings.rowDensity}
					/>
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
						{#key session.activeRepo}
							<GraphView
								rows={visibleRows}
								{selectedHash}
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
						title={open.title}
						listHunks={diffView.listHunks}
						listLineTokens={diffView.listTokens}
						notice={diffView.notice}
						loading={diffView.loading}
						mode={prefs.settings.diffMode}
						onmode={diffView.setMode}
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
				branchName={currentBranch}
				{ahead}
				{behind}
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
