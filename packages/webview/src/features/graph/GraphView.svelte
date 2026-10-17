<script lang="ts">
	import type {
		BranchActionId,
		Commit,
		CommitActionId,
		CommitStat,
		ExplainTarget,
		GraphRow,
		HiddenRefs,
		Ref,
		RemoteBranchRef,
		UpstreamTracking,
	} from '@git-octopus/shared';
	import { assertNever, hasGap, isLevel } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import { laneX, type LaneMetrics } from '../../lib/graphPath';
	import { rowWindow, shouldAskLoadMore } from '../../lib/virtualWindow';
	import { laneSegments, type LaneSegment } from '../../lib/graphSegments';
	import type { ParsedSubject } from '../../lib/commitSubject';
	import { formatSubject, parseSubject, typeColour } from '../../lib/commitSubject';
	import type { RefChip } from '../../lib/graphChips';
	import { buildChips, chipRef, chipRemote, isDropTarget, splitChips } from '../../lib/graphChips';
	import { ghostBranchFor, mapLaneBranches } from '../../lib/ghostBranch';
	import { formatCommitDate } from '../../lib/commitDate';
	import { authorTooltip } from '../../lib/authorTooltip';
	import { changesGauge, changesTooltip } from '../../lib/changesGauge';
	import {
		buildCommitMenuItems,
		buildDropMenuItems,
		type DropDescription,
		buildHeaderMenuItems,
		buildMultiMenuItems,
		buildRefMenu,
		resolveMenuSelection,
		type MenuBuild,
		type MenuEntry,
		type MultiAction,
		type RefTarget,
	} from '../../lib/graphMenu';
	import { clampExpandRight, expanderAnchor, shouldExpand } from '../../lib/refExpander';
	import { tooltip } from '../../lib/ui/tooltip';
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import { MAP_SIGNATURE_LOOK } from '../../lib/signature';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import RefIcon from '../../lib/ui/RefIcon.svelte';
	import {
		LIST_DEFAULT_COLUMN_ORDER,
		mapRowHeight,
		normalizeColumnOrder,
		type OptionalColumn,
	} from '../../lib/viewSettings';
	import type {
		ColumnKey,
		ColumnVisibility,
		ColumnWidths,
		DateType,
		GraphStyle,
		RowDensity,
	} from '../../lib/viewSettings';

	let {
		rows,
		selectedHash,
		listSelectedHashes,
		currentBranch,
		lastPicked,
		columns,
		widths,
		compareHash,
		dateType,
		graphStyle,
		rowDensity,
		highlightHover,
		muteMerges,
		showTicketBadge,
		showTypeBadge,
		showTracking,
		mapTracking,
		showGhostBranch,
		headHash,
		fastForward,
		scrollTarget,
		hasMore,
		setFindMatches = new Set<string>(),
		findCurrent = null,
		pinnedRef = null,
		listSolo = [],
		columnOrder = LIST_DEFAULT_COLUMN_ORDER,
		onreorderColumn = () => {},
		onpin = () => {},
		onsolo = () => {},
		onhide = () => {},
		onrelated = () => {},
		oninteractiveRebase = () => {},
		onexplain = () => {},
		mapWorktrees = {},
		onworktree = () => {},
		oninteractiveRebaseOnto = () => {},
		mapCommitStats = {},
		onneedStats = () => {},
		onjumpPinned = () => {},
		onselect,
		onselectRange,
		oncompare,
		oncompareWorking,
		oncheckoutBranch,
		onaction,
		onmulti,
		onloadMore,
		onbranchAction,
		onfilterBranch,
		oncheckFastForward,
		ontoggleColumn,
		onresizeColumn,
	}: {
		rows: GraphRow[];
		selectedHash: string | null;
		/** Shift-click range selection, in row order (newest first); [] when nothing is multi-selected. */
		listSelectedHashes: string[];
		currentBranch: string | null;
		/** The branch most recently checked out this session — wins the collapsed chip slot. */
		lastPicked: string | null;
		columns: ColumnVisibility;
		widths: ColumnWidths;
		compareHash: string | null;
		/** Which of the commit's two dates the Date column shows. */
		dateType: DateType;
		graphStyle: GraphStyle;
		/** How tall each commit row is drawn. */
		rowDensity: RowDensity;
		/** Whether hovering a row lights up its branch line and dims the others. */
		highlightHover: boolean;
		/** Dim merge-commit rows so the real work stands out. */
		muteMerges: boolean;
		/** Off for either one leaves that part of the subject as plain text instead of a chip. */
		showTicketBadge: boolean;
		showTypeBadge: boolean;
		/** Whether a branch chip shows how far it has drifted from its upstream. */
		showTracking: boolean;
		/** Local branch name -> its drift from upstream, as of the last fetch. */
		mapTracking: Record<string, UpstreamTracking | null>;
		/** Name the lane a selected or hovered commit is drawn on, when it carries no ref itself. */
		showGhostBranch: boolean;
		/** The commit HEAD stands at — a range rebase is only offered on a selection reaching it. */
		headHash: string | null;
		/** The host's answer to the last fast-forward question, matched by nonce. */
		fastForward: { nonce: number; canFastForward: boolean } | null;
		/** Bumping `nonce` scrolls the given hash into view. */
		scrollTarget: { hash: string; nonce: number } | null;
		/** Whether history continues past the loaded rows — scrolling near the bottom loads more. */
		hasMore: boolean;
		/** Commits the find query matches, drawn highlighted in place. */
		setFindMatches?: Set<string>;
		/** The match the find box last stepped to, drawn stronger than the rest. */
		findCurrent?: string | null;
		/** The branch held on the left edge, as its menus name it — `main` or `origin/main`. */
		pinnedRef?: string | null;
		/** Left-to-right order of the columns right of Description. */
		columnOrder?: OptionalColumn[];
		/** A column header dropped onto another: move `from` to where `to` stands. */
		onreorderColumn?: (from: OptionalColumn, to: OptionalColumn) => void;
		/** The refs the graph is limited to; empty when it shows everything. */
		listSolo?: string[];
		/** Pin a branch to the left edge, or unpin with null. */
		onpin?: (ref: string | null) => void;
		/** Add a ref to the set the graph is limited to, or take one out. */
		onsolo?: (op: 'add' | 'remove', ref: string) => void;
		/** Leave refs out of the graph. */
		onhide?: (refs: HiddenRefs) => void;
		/** Limit the graph to the checked-out branch and the branches it relates to. */
		onrelated?: () => void;
		/** Open the interactive rebase editor over the commits after `base`. */
		oninteractiveRebase?: (base: string) => void;
		onexplain?: (target: ExplainTarget) => void;
		/** Branch → folder, for the branches checked out in another worktree. */
		mapWorktrees?: Record<string, string>;
		/** Open a worktree's folder in a new window, or create a worktree for a branch. */
		onworktree?: (op: 'open' | 'add', value: string) => void;
		/** Sizes for the Changes column, by hash; a commit missing here shows an empty cell. */
		mapCommitStats?: Record<string, CommitStat>;
		/** The Changes column wants sizes for these rows on screen. */
		onneedStats?: (listHashes: string[]) => void;
		/** Rebase a local branch onto another ref through the rebase editor. */
		oninteractiveRebaseOnto?: (base: string, baseLabel: string, branch: string) => void;
		/** Scroll to the pinned branch's tip. */
		onjumpPinned?: () => void;
		onselect: (hash: string) => void;
		/** Shift-click: extend the selection from the anchor to this commit. */
		onselectRange: (hash: string) => void;
		oncompare: (hash: string) => void;
		/** Compare this commit with the files on disk. */
		oncompareWorking: (hash: string) => void;
		/** Check out a branch chip: a local name when there is one, otherwise a remote-tracking one. */
		oncheckoutBranch: (local: string | null, remote: RemoteBranchRef | null) => void;
		onaction: (action: CommitActionId, commit: Commit, target?: RefTarget) => void;
		/** Act on the multi-selected commits (newest → oldest). */
		onmulti: (action: MultiAction, listHashes: string[]) => void;
		onloadMore: () => void;
		/** One branch chip dropped onto another: merge, rebase or fast-forward. */
		/** `targetRemote` names the remote when the action is aimed at the target's branch there. */
		onbranchAction: (
			action: BranchActionId,
			source: string,
			sourceLabel: string,
			target: string,
			targetRemote?: string
		) => void;
		/** "Show only this branch" picked from a ref menu — reload the graph walking `ref` alone. */
		onfilterBranch: (ref: string) => void;
		oncheckFastForward: (source: string, target: string, nonce: number) => void;
		ontoggleColumn: (column: keyof ColumnVisibility) => void;
		onresizeColumn: (column: ColumnKey, width: number) => void;
	} = $props();

	/** What the ref menus need to know about the view to name their entries. */
	const refView = $derived({ pinnedRef, listSolo, mapWorktrees });

	const mapCommitByHash = $derived(new Map(rows.map((row) => [row.commit.hash, row.commit])));
	/**
	 * Whether `hash` lies below HEAD on HEAD's own first-parent line — the commits between them are
	 * what an interactive rebase from it would rewrite. Bounded by the row count, so a cycle in bad
	 * data cannot spin.
	 */
	function onHeadLine(hash: string): boolean {
		if (!headHash || hash === headHash) return false;
		let at = mapCommitByHash.get(headHash)?.parents[0];
		for (let steps = 0; at !== undefined && steps < rows.length; steps++) {
			if (at === hash) return true;
			at = mapCommitByHash.get(at)?.parents[0];
		}
		return false;
	}

	const ROW_H = $derived(mapRowHeight[rowDensity]);
	const COL_W = 20;
	const PAD = 12;
	const NODE_R = 5;
	/** Radius used when a commit shows its author's avatar instead of a plain dot. */
	const AVATAR_R = 9;
	/**
	 * Avatars sit on the path of every pointer crossing the graph, so their tooltip waits long enough
	 * that only a pointer which stopped on one gets it.
	 */
	const AVATAR_TIP_DELAY = 2000;
	/** Lane lines are drawn hairline-thin: a graph this dense turns to mush at any real weight. */
	const EDGE_W = 1.5;
	/** How far a lane's corner is rounded off when it changes column. */
	const CURVE = 8;
	/** Codicon glyph for `archive`, drawn inside the stash node. */
	const STASH_GLYPH = '';
	/** Icon at the head of a chip that is not a branch. */
	const mapChipGlyph: Record<'tag' | 'stash' | 'head', string> = {
		tag: 'tag',
		stash: 'archive',
		head: 'target',
	};
	const OVERSCAN = 8;
	/** How long the rows on screen have to hold still before the Changes column asks for sizes. */
	const STATS_DELAY_MS = 120;
	const MIN_COL_W = 60;

	/** Breathing room so the overlay scrollbar never sits on top of the Date column. */
	const SCROLL_GUTTER = 8;
	/**
	 * What Description keeps however many columns are on: below this the messages turn into "De…".
	 * Past it the graph scrolls sideways instead, header and rows together.
	 */
	const DESCRIPTION_MIN_W = 200;
	/** `--gg-space-2`, the gap between columns — the minimum width below adds one per gap. */
	const COLUMN_GAP = 8;

	let viewport = $state<HTMLDivElement | null>(null);
	/** Clips the header strip and scrolls it sideways with the rows below. */
	let headersClip = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	let viewportW = $state(0);

	/** Branch-line under the pointer: every other branch's lanes and nodes dim while it is set. */
	let hoveredBranch = $state<number | null>(null);

	/** The ref being dragged: what git is handed, plus the shorter form the menus print. */
	let dragSource = $state<{ ref: string; label: string; local: boolean } | null>(null);
	/** The row under the pointer — only tracked while the ghost label needs it. */
	let hoveredRow = $state<string | null>(null);

	/** The local branch under the pointer, i.e. where dropping would land. */
	let dropTarget = $state<string | null>(null);
	let dropMenu = $state<
		| ({
				x: number;
				y: number;
				source: string;
		  } & DropDescription)
		| null
	>(null);
	/** Identifies the fast-forward question asked for the current drop, so stale answers are ignored. */
	let ffNonce = $state(0);

	/**
	 * Width the scrollbar takes out of the scroll area (0 for macOS overlay scrollbars). The header
	 * sits outside that area, so it needs the same inset to stay aligned with the rows.
	 */
	const scrollbarW = $derived(viewport && viewportW ? viewport.offsetWidth - viewportW : 0);
	/** `chip` set means the menu was opened on one ref, and acts only on that ref. */
	let menu = $state<{ x: number; y: number; commit: Commit; chip?: RefChip } | null>(null);
	let headerMenu = $state<{ x: number; y: number } | null>(null);
	let resizing = $state<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

	/**
	 * The columns the header menu can hide, in render order. They all sit after Description, so they
	 * share one shape — see {@link onResizeMove} for why their handles are on the left.
	 */
	const LIST_OPTIONAL_COLUMNS: { key: keyof ColumnVisibility; label: string }[] = [
		{ key: 'author', label: 'Author' },
		{ key: 'commit', label: 'Commit' },
		{ key: 'date', label: 'Date' },
		{ key: 'changes', label: 'Changes' },
	];

	const cols = $derived(graphWidth(rows));
	const graphPx = $derived(cols * COL_W + PAD);
	const totalH = $derived(rows.length * ROW_H);
	const range = $derived(rowWindow(scrollTop, viewportH, ROW_H, rows.length, OVERSCAN));
	const visible = $derived(
		rows.slice(range.start, range.end).map((row, k) => ({ row, index: range.start + k }))
	);

	// Sizes are read only for what is on screen, once the scrolling settles.
	$effect(() => {
		if (!columns.changes) return;
		const listHashes = visible
			.filter((v) => !v.row.commit.isUncommitted)
			.map((v) => v.row.commit.hash);
		const timer = setTimeout(() => onneedStats(listHashes), STATS_DELAY_MS);
		return () => clearTimeout(timer);
	});

	/** The optional columns in the order the user arranged them — header, grid and cells alike. */
	const listOrderedColumns = $derived(
		normalizeColumnOrder(columnOrder).map(
			(key) =>
				LIST_OPTIONAL_COLUMNS.find((column) => column.key === key) ?? LIST_OPTIONAL_COLUMNS[0]
		)
	);
	/** The column whose header label is being dragged to a new place. */
	let draggedColumn = $state<OptionalColumn | null>(null);

	const gridTemplate = $derived(
		[
			`${widths.ref}px`,
			`${graphPx}px`,
			`minmax(${DESCRIPTION_MIN_W}px, 1fr)`,
			...listOrderedColumns
				.filter((column) => columns[column.key])
				.map((column) => `${widths[column.key]}px`),
		].join(' ')
	);

	/** The narrowest the columns fit in; a narrower view scrolls sideways rather than squeeze them. */
	const minGridW = $derived.by(() => {
		const listTracks = [
			widths.ref,
			graphPx,
			DESCRIPTION_MIN_W,
			...listOrderedColumns
				.filter((column) => columns[column.key])
				.map((column) => widths[column.key]),
		];
		const total = listTracks.reduce((sum, width) => sum + width, 0);
		return total + COLUMN_GAP * (listTracks.length - 1) + SCROLL_GUTTER;
	});

	const headerMenuItems = $derived(buildHeaderMenuItems(columns));

	const metrics = $derived<LaneMetrics>({
		columnWidth: COL_W,
		rowHeight: ROW_H,
		padding: PAD,
		curve: CURVE,
		style: graphStyle,
	});

	/*
	 * The line from the working tree down to HEAD is drawn dashed: what it joins is not a commit yet.
	 * It is the working-tree row's lane, from that row's node to HEAD's, through any rows between.
	 */
	const headIndex = $derived(rows.findIndex((row) => row.commit.hash === headHash));
	const wtBranch = $derived(
		rows[0]?.commit.isUncommitted
			? (laneSegments(rows[0], metrics).find((segment) => segment.fromNode)?.branch ?? null)
			: null
	);
	function isWorkingLine(segment: LaneSegment, index: number, row: GraphRow): boolean {
		if (wtBranch === null) return false;
		if (row.commit.isUncommitted) return segment.fromNode;
		return index <= headIndex && !segment.fromNode && segment.branch === wtBranch;
	}

	/** Chips of one commit, ordered and collapsed by the pure helper in `lib/graphChips`. */
	const chipsFor = (refs: Ref[]): RefChip[] =>
		buildChips(refs, currentBranch, lastPicked, mapTracking);

	/** Lane -> the branch it belongs to, for the ghost label on rows carrying no chip. */
	const mapGhostNames = $derived(mapLaneBranches(rows));

	/**
	 * The expanded ref column: every chip of one row, at full width, drawn over the collapsed cell.
	 *
	 * The column is narrow, so a row's chips arrive both cut down to an ellipsis and folded behind
	 * a `+N` badge. Hovering the cell opens all of them rather than making the badge the only way
	 * in — the badge is a small target, and it says nothing about the truncated name beside it.
	 */
	let refExpand = $state<{
		right: number;
		y: number;
		listChips: RefChip[];
		commit: Commit;
	} | null>(null);
	let expandCloseTimer: ReturnType<typeof setTimeout> | undefined;
	let expandOpenTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * How far the panel's first chip sits inside the panel's own top-right corner: its border plus
	 * its padding. The anchor cancels this out, so the chip lands exactly on the one it replaces
	 * instead of a few pixels down and left of it.
	 */
	const EXPAND_INSET = 5;
	/** Breathing room kept between the panel and the edge of the view it must stay inside. */
	const EXPAND_MARGIN = 8;
	/** Long enough that running the pointer down the column does not strobe panels open behind it. */
	const EXPAND_DELAY = 180;

	function openRefExpand(
		event: MouseEvent,
		commit: Commit,
		listChips: RefChip[],
		hasOverflow: boolean
	): void {
		clearTimeout(expandCloseTimer);
		clearTimeout(expandOpenTimer);
		const cell = event.currentTarget as HTMLElement;
		// Measured on the names, not on the cell. Chips are allowed to shrink (`flex: 0 1 auto`), so
		// a column too narrow for them ellipsises each name in place instead of overflowing the cell
		// — by the time the cell itself scrolls, the names have already been cut for some time.
		const isTruncated = [...cell.querySelectorAll('.ref-name')].some(
			(name) => name.scrollWidth > name.clientWidth
		);
		if (!shouldExpand({ listChips, hasOverflow, isTruncated })) {
			refExpand = null;
			return;
		}
		const first = cell.firstElementChild;
		if (!first) return;
		const box = first.getBoundingClientRect();
		expandWidth = 0;
		expandOpenTimer = setTimeout(() => {
			refExpand = { ...expanderAnchor(box, EXPAND_INSET, window.innerWidth), listChips, commit };
		}, EXPAND_DELAY);
	}

	/**
	 * Delayed, so the pointer can travel from the cell into the panel without it vanishing.
	 *
	 * A ref menu opened from one of these chips pins the panel open. Otherwise moving the pointer
	 * onto that menu — which is what the user does next — reads as leaving the panel, and the chips
	 * vanish out from under the menu they raised, leaving it naming a ref with nothing on screen to
	 * tie it to.
	 */
	function scheduleExpandClose(): void {
		clearTimeout(expandOpenTimer);
		clearTimeout(expandCloseTimer);
		expandCloseTimer = setTimeout(() => {
			if (menu?.chip) return;
			refExpand = null;
		}, 150);
	}

	function cancelExpandClose(): void {
		clearTimeout(expandCloseTimer);
	}

	/**
	 * The panel's measured width, and the anchor corrected against it.
	 *
	 * Two passes rather than one: the width is only knowable once the chips are laid out, and the
	 * correction needs it. The panel stays hidden through the first pass — a visible slide from the
	 * wrong place to the right one would read as the panel flinching.
	 */
	let expandWidth = $state(0);
	const expandRight = $derived(
		refExpand ? clampExpandRight(refExpand.right, expandWidth, window.innerWidth, EXPAND_MARGIN) : 0
	);

	function checkoutChip(chip: RefChip): void {
		refExpand = null;
		if (chip.checkedOut) return;
		oncheckoutBranch(chip.hasLocal ? chip.name : null, chipRemote(chip));
	}

	/**
	 * The text of the subject line. A part only leaves the text when a badge is showing it, so
	 * turning both badges off prints the subject exactly as it was written.
	 */
	function subjectText(parsed: ParsedSubject): string {
		return formatSubject({
			...parsed,
			ticket: showTicketBadge ? null : parsed.ticket,
			type: showTypeBadge ? null : parsed.type,
		});
	}

	// Not a setting: Today/Yesterday + time is the one format the column ships with.
	const fmtDate = (epochSeconds: number): string => formatCommitDate(epochSeconds, 'dayTime');

	const setSelected = $derived(new Set(listSelectedHashes));
	/** The multi-selected commits in row order — the unit the "Squash n" menu item acts on. */
	const listSelectedCommits = $derived(
		listSelectedHashes.length > 1
			? listSelectedHashes
					.map((hash) => rows.find((row) => row.commit.hash === hash)?.commit)
					.filter((commit): commit is Commit => commit !== undefined)
			: []
	);

	function openMenu(event: MouseEvent, commit: Commit): void {
		event.preventDefault();
		// Right-clicking inside the multi-selection keeps it, so the menu can act on the whole range.
		if (!setSelected.has(commit.hash) || listSelectedHashes.length < 2) onselect(commit.hash);
		if (commit.isUncommitted) return;
		menu = { x: event.clientX, y: event.clientY, commit };
	}

	/**
	 * The menu for one ref. It stops the event rather than letting the row see it: the click named a
	 * ref, and the commit menu would answer a question that was not asked.
	 */
	function openRefMenu(event: MouseEvent, commit: Commit, chip: RefChip): void {
		// Built before the event is stopped: a chip with nothing of its own to offer — detached HEAD
		// — must let the right-click reach the row, or it opens an empty menu instead of the commit's.
		if (buildRefMenu(chip, currentBranch, refView).items.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		// The panel stays up while its menu is open: `.ref-expand` sits below `ContextMenu` in the
		// stack, so the menu draws over it, and the chips keep saying which ref the menu is about.
		clearTimeout(expandCloseTimer);
		onselect(commit.hash);
		if (commit.isUncommitted) return;
		menu = { x: event.clientX, y: event.clientY, commit, chip };
	}

	/** Whether the dragged chip may land here, read against the drag in flight right now. */
	function canDrop(chip: RefChip): boolean {
		return isDropTarget(chip, dragSource?.label ?? null);
	}

	function onChipDragStart(event: DragEvent, chip: RefChip): void {
		const source = chipRef(chip);
		if (!source) {
			event.preventDefault();
			return;
		}
		dragSource = { ...source, local: chip.hasLocal };
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'copy';
			event.dataTransfer.setData('text/plain', source.label);
		}
	}

	function onChipDragOver(event: DragEvent, chip: RefChip): void {
		if (!canDrop(chip)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropTarget = chip.name;
	}

	function onChipDrop(event: DragEvent, chip: RefChip): void {
		if (!canDrop(chip) || !dragSource) return;
		event.preventDefault();
		event.stopPropagation();
		dropMenu = {
			x: event.clientX,
			y: event.clientY,
			source: dragSource.ref,
			sourceLabel: dragSource.label,
			sourceLocal: dragSource.local,
			target: chip.name,
			targetLocal: chip.hasLocal,
			listTargetRemotes: chip.listRemotes,
		};
		ffNonce += 1;
		// The answer decides whether the menu offers a fast-forward; it lands while the menu is open.
		if (chip.hasLocal) oncheckFastForward(dragSource.ref, chip.name, ffNonce);
		dragSource = null;
		dropTarget = null;
	}

	function endDrag(): void {
		dragSource = null;
		dropTarget = null;
	}

	// `ffNonce` is read live: only the answer to *this* drop's question may add the entry.
	const dropMenuItems = $derived(buildDropMenuItems(dropMenu, fastForward, ffNonce));

	function onDropMenuSelect(id: string): void {
		const drop = dropMenu;
		dropMenu = null;
		if (!drop) return;
		const [action, remote] = id.split(':') as [
			BranchActionId | 'interactiveRebase',
			string | undefined,
		];
		if (action === 'interactiveRebase') {
			// Only offered for a local source, whose ref is its branch name.
			oninteractiveRebaseOnto(
				remote ? `refs/remotes/${remote}/${drop.target}` : `refs/heads/${drop.target}`,
				remote ? `${remote}/${drop.target}` : drop.target,
				drop.source
			);
			return;
		}
		onbranchAction(action, drop.source, drop.sourceLabel, drop.target, remote);
	}

	const openMenuBuild = $derived.by((): MenuBuild => {
		if (!menu) return { items: [], mapEntries: {} };
		if (menu.chip) return buildRefMenu(menu.chip, currentBranch, refView);
		// A right-click inside the multi-selection acts on the range, not the single commit.
		if (listSelectedCommits.length > 1 && setSelected.has(menu.commit.hash)) {
			return buildMultiMenuItems(listSelectedCommits, headHash);
		}
		return buildCommitMenuItems(menu.commit, currentBranch, chipsFor(menu.commit.refs), {
			...refView,
			rebaseFromHere: onHeadLine(menu.commit.hash),
		});
	});

	const menuItems = $derived(openMenuBuild.items);

	function onMenuSelect(id: string): void {
		const open = menu;
		// Read before closing: `openMenuBuild` is derived from `menu`, and clearing it first would
		// leave nothing to look the id up in.
		const selected = resolveMenuSelection(openMenuBuild.items, id);
		const entry = openMenuBuild.mapEntries[id];
		closeMenu();
		// A disabled entry resolves to nothing. `ContextMenu` will not fire one either; both have to
		// agree, because the id alone cannot say whether the action was ruled out. `entry` is checked
		// too because a `Record` index types as always present — a row whose id never got an entry
		// would dispatch `undefined`.
		if (!open || !selected || !entry) return;
		runEntry(entry, open.commit);
	}

	/** Closing the menu releases the expanded column it was pinning, if it came from one. */
	function closeMenu(): void {
		menu = null;
		refExpand = null;
	}

	function runEntry(entry: MenuEntry, commit: Commit): void {
		switch (entry.type) {
			case 'filter':
				onfilterBranch(entry.ref);
				return;
			case 'compareWorking':
				oncompareWorking(commit.hash);
				return;
			case 'pin':
				onpin(entry.ref);
				return;
			case 'solo':
				onsolo(entry.op, entry.ref);
				return;
			case 'hide':
				onhide(entry.refs);
				return;
			case 'related':
				onrelated();
				return;
			case 'interactiveRebase':
				oninteractiveRebase(commit.hash);
				return;
			case 'explain':
				onexplain(entry.target);
				return;
			case 'worktree':
				onworktree(entry.op, entry.op === 'open' ? entry.path : entry.branch);
				return;
			case 'multi':
				onmulti(
					entry.action,
					listSelectedCommits.map((selected) => selected.hash)
				);
				return;
			case 'commit':
				onaction(entry.action, commit, entry.target);
				return;
			case 'branch': {
				const source = chipRef(entry.target.chip);
				if (source) onbranchAction(entry.action, source.ref, source.label, entry.onto);
				return;
			}
			default:
				// A new kind of entry has to name what runs it here; without this a menu row built
				// from it would look live and do nothing.
				assertNever(entry);
		}
	}

	/** Row count the last load-more was asked at, so one scroll position asks only once. */
	let loadMoreAskedAt = 0;

	function onScroll(): void {
		if (!viewport) return;
		scrollTop = viewport.scrollTop;
		if (headersClip) headersClip.scrollLeft = viewport.scrollLeft;
		// Anchored to a screen position, so any scroll leaves it floating over the wrong row.
		refExpand = null;
		const ask = shouldAskLoadMore({
			scrollTop,
			viewportH,
			totalH,
			rowH: ROW_H,
			rowCount: rows.length,
			askedAt: loadMoreAskedAt,
			hasMore,
		});
		if (ask) {
			loadMoreAskedAt = rows.length;
			onloadMore();
		}
	}

	function startResize(key: ColumnKey, event: MouseEvent): void {
		event.preventDefault();
		resizing = { key, startX: event.clientX, startWidth: widths[key] };
	}

	/**
	 * Description absorbs the leftover width, so every column after it is pinned to the right edge
	 * and carries its handle on its left edge — where growing the column means moving the pointer
	 * left. Only `ref`, which sits before Description, grows the same way the pointer travels.
	 */
	function onResizeMove(event: MouseEvent): void {
		if (!resizing) return;
		const delta = event.clientX - resizing.startX;
		const signed = resizing.key === 'ref' ? delta : -delta;
		onresizeColumn(resizing.key, Math.max(MIN_COL_W, resizing.startWidth + signed));
	}

	$effect(() => {
		// Turning the setting off mid-hover would otherwise leave the graph frozen in a dimmed state.
		if (!highlightHover) hoveredBranch = null;
	});

	/**
	 * The last scroll request already honoured. The effect below re-runs whenever `rows` changes
	 * (a status update rebuilds the array), and without this it would drag the view back to a
	 * target the user has long scrolled away from.
	 */
	let lastScrollNonce = 0;

	$effect(() => {
		const target = scrollTarget;
		if (!target || target.nonce === lastScrollNonce || !viewport) return;
		// Not marked as honoured on a miss: the target may be in a page still being loaded.
		const index = rows.findIndex((row) => row.commit.hash === target.hash);
		if (index === -1) return;
		lastScrollNonce = target.nonce;
		viewport.scrollTo({ top: Math.max(0, index * ROW_H - viewport.clientHeight / 2) });
	});
</script>

{#snippet optionalCell(key: OptionalColumn, commit: Commit)}
	{#if key === 'author'}
		<span class="muted author">
			{#if commit.author.avatarUrl}
				<img
					class="avatar"
					src={commit.author.avatarUrl}
					alt=""
					use:tooltip={{
						text: authorTooltip(commit, dateType),
						delay: AVATAR_TIP_DELAY,
					}}
				/>
			{/if}
			{commit.author.name}
		</span>
	{:else if key === 'commit'}
		<span class="muted mono">
			{commit.isUncommitted ? '*' : commit.hash.slice(0, 8)}
		</span>
	{:else if key === 'date'}
		<span class="muted date">
			{#if commit.isUncommitted}—{:else}{fmtDate(
					dateType === 'author' ? commit.authoredAt : commit.committedAt
				)}{/if}
		</span>
	{:else}
		{@const stat = commit.isUncommitted ? undefined : mapCommitStats[commit.hash]}
		<span class="changes" use:tooltip={stat ? changesTooltip(stat) : ''}>
			{#if commit.isUncommitted}
				<span class="muted">—</span>
			{:else if stat}
				{@const gauge = changesGauge(stat)}
				<span class="gauge" style="width:{gauge.widthPct}%">
					<span class="gauge-added" style="width:{gauge.addedPct}%"></span>
				</span>
				<span class="added">+{stat.insertions}</span>
				<span class="removed">−{stat.deletions}</span>
			{/if}
		</span>
	{/if}
{/snippet}

<svelte:window onmousemove={onResizeMove} onmouseup={() => (resizing = null)} />

{#snippet chipBody(chip: RefChip)}
	{#if chip.kind !== 'branch'}
		<span class="glyph">
			<Icon name={mapChipGlyph[chip.kind]} />
		</span>
	{/if}
	<span class="seg">
		{#if chip.checkedOut}<span class="check"><RefIcon name="check" size={12} /></span>{/if}
		<span class="ref-name">{chip.name}</span>
	</span>
	{#if chip.hasLocal}
		<span class="seg indicator"><RefIcon name="device-desktop" /></span>
	{/if}
	{#if chip.listRemotes.length > 0}
		<span class="seg indicator"><RefIcon name="cloud" /></span>
	{/if}
	{#if showTracking && chip.tracking && !isLevel(chip.tracking)}
		<!-- Nothing is drawn while a branch is level: the column is narrow, and a badge that appears
		     on every chip stops meaning anything. -->
		<span class="seg tracking" class:gone={chip.tracking.gone}>
			{#if chip.tracking.gone}
				gone
			{:else}
				{#if hasGap(chip.tracking.ahead)}<span class="drift">↑{chip.tracking.ahead ?? '?'}</span
					>{/if}{#if hasGap(chip.tracking.behind)}<span class="drift"
						>↓{chip.tracking.behind ?? '?'}</span
					>{/if}
			{/if}
		</span>
	{/if}
{/snippet}

<div class="graph-view">
	<div class="headers-clip" bind:this={headersClip}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="headers"
			style="grid-template-columns:{gridTemplate}; padding-right:{SCROLL_GUTTER + scrollbarW}px;
			min-width:{minGridW + scrollbarW}px"
			oncontextmenu={(event) => {
				event.preventDefault();
				headerMenu = { x: event.clientX, y: event.clientY };
			}}
			title="Right-click to show or hide columns"
		>
			<span class="hcell">
				<span class="hlabel">Branch / Tag</span>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="grip resizable"
					class:active={resizing?.key === 'ref'}
					title="Drag to resize the Branch / Tag column"
					onmousedown={(event) => startResize('ref', event)}
				></span>
			</span>
			<span class="hcell">
				<span class="hlabel">Graph</span>
				{#if pinnedRef}
					<IconButton
						name="pinned"
						label="Jump to the pinned branch"
						title="{pinnedRef} is pinned to the left — click to jump to it"
						onclick={onjumpPinned}
					/>
				{/if}
				<span class="grip"></span>
			</span>
			<span class="hcell">
				<span class="hlabel">Description</span>
			</span>
			<!--
			Description takes the leftover width, so Author, Commit and Date are pinned to the right
			edge: the divider left of a column is the only one its own width can move. Each of them
			therefore carries its handle on its left edge, and the decorative divider that used to
			close the Description cell would now sit in the same gap as that handle.
		-->
			{#each listOrderedColumns as column (column.key)}
				{#if columns[column.key]}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="hcell"
						class:end={column.key === 'date'}
						class:drop-column={draggedColumn !== null && draggedColumn !== column.key}
						ondragover={(event) => {
							if (draggedColumn === null || draggedColumn === column.key) return;
							event.preventDefault();
						}}
						ondrop={(event) => {
							event.preventDefault();
							if (draggedColumn !== null && draggedColumn !== column.key)
								onreorderColumn(draggedColumn, column.key);
							draggedColumn = null;
						}}
					>
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="grip left resizable"
							class:active={resizing?.key === column.key}
							title="Drag to resize the {column.label} column"
							onmousedown={(event) => startResize(column.key, event)}
						></span>
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="hlabel movable"
							draggable="true"
							title="Drag onto another column to move it there"
							ondragstart={(event) => {
								draggedColumn = column.key;
								event.dataTransfer?.setData('text/plain', column.label);
							}}
							ondragend={() => (draggedColumn = null)}>{column.label}</span
						>
					</span>
				{/if}
			{/each}
		</div>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="scroll"
		bind:this={viewport}
		bind:clientHeight={viewportH}
		bind:clientWidth={viewportW}
		onscroll={onScroll}
		onmouseleave={() => (hoveredBranch = null)}
	>
		<div class="inner" style="height:{totalH}px; min-width:{minGridW}px">
			<svg
				class="lines"
				width={graphPx}
				height={totalH}
				style="left:{widths.ref}px"
				aria-hidden="true"
			>
				{#each visible as v (v.row.commit.hash)}
					{@const commit = v.row.commit}
					{@const isStash = commit.refs.some((ref) => ref.kind === 'stash')}
					{@const isMerge = commit.parents.length > 1}
					{@const avatar =
						!commit.isUncommitted && !isMerge && !isStash ? commit.author.avatarUrl : undefined}
					{@const nodeX = laneX(v.row.nodeColumn, metrics)}
					{@const colour = graphColour(v.row.nodeColour)}
					<!-- One band per row, drawn in its own coordinates: every lane runs edge to edge, so the
					     bands stack seamlessly and no row has to know what the row below it looks like. -->
					<g transform="translate(0,{v.index * ROW_H})">
						{#each laneSegments(v.row, metrics) as segment, s (s)}
							<path
								d={segment.d}
								class:dim={hoveredBranch !== null && segment.branch !== hoveredBranch}
								stroke={graphColour(segment.colour)}
								stroke-width={EDGE_W}
								stroke-linecap="round"
								stroke-dasharray={(isStash && segment.fromNode) ||
								isWorkingLine(segment, v.index, v.row)
									? '3 3'
									: undefined}
								fill="none"
							/>
						{/each}

						<!-- The node is painted over the lanes in the page's own background, which hides
						     whatever runs behind it. Trimming the lanes instead would mean each of them having
						     to know the size and kind of the node at its far end. -->
						<circle
							cx={nodeX}
							cy={ROW_H / 2}
							r={(avatar ? AVATAR_R : NODE_R) + 2}
							fill="var(--gg-bg)"
						/>

						<g class:dim={hoveredBranch !== null && v.row.nodeBranch !== hoveredBranch}>
							{#if commit.hash === headHash && !commit.isUncommitted}
								<!-- A halo marks the checked-out commit on the graph itself, not only on its chip. -->
								<circle
									class="head-halo"
									cx={nodeX}
									cy={ROW_H / 2}
									r={(avatar ? AVATAR_R : NODE_R) + 4}
									fill="none"
									stroke={colour}
									stroke-width="2"
								/>
							{/if}
							{#if isStash}
								<text
									x={nodeX}
									y={ROW_H / 2}
									fill={colour}
									font-family="codicon"
									font-size="16"
									text-anchor="middle"
									dominant-baseline="central">{STASH_GLYPH}</text
								>
							{:else if commit.isUncommitted}
								<circle
									cx={nodeX}
									cy={ROW_H / 2}
									r={NODE_R}
									fill="none"
									stroke={colour}
									stroke-width="2"
									stroke-dasharray="2.5 2"
								/>
							{:else if isMerge}
								<!-- A ring with a dot in it: a merge has no single author worth showing, and the
							     shape reads as "two lines met here" at a glance. -->
								<circle
									cx={nodeX}
									cy={ROW_H / 2}
									r={NODE_R - 1}
									fill="none"
									stroke={colour}
									stroke-width="2"
								/>
								<circle cx={nodeX} cy={ROW_H / 2} r="1.5" fill={colour} />
							{:else if avatar}
								<clipPath id="gg-clip-{commit.hash}">
									<circle cx={nodeX} cy={ROW_H / 2} r={AVATAR_R} />
								</clipPath>
								<circle cx={nodeX} cy={ROW_H / 2} r={AVATAR_R} fill={colour} />
								<image
									href={avatar}
									x={nodeX - AVATAR_R}
									y={ROW_H / 2 - AVATAR_R}
									width={AVATAR_R * 2}
									height={AVATAR_R * 2}
									clip-path="url(#gg-clip-{commit.hash})"
									preserveAspectRatio="xMidYMid slice"
								/>
								<circle
									cx={nodeX}
									cy={ROW_H / 2}
									r={AVATAR_R}
									fill="none"
									stroke={colour}
									stroke-width="2"
								/>
								<!-- The ring above is drawn unfilled, so on its own it only answers the pointer along
								     the stroke. This disc catches the whole avatar. -->
								<circle
									cx={nodeX}
									cy={ROW_H / 2}
									r={AVATAR_R}
									fill="transparent"
									use:tooltip={{ text: authorTooltip(commit, dateType), delay: AVATAR_TIP_DELAY }}
								/>
							{:else}
								<circle cx={nodeX} cy={ROW_H / 2} r={NODE_R} fill={colour} />
							{/if}
						</g>
					</g>
				{/each}
			</svg>

			{#each visible as v (v.row.commit.hash)}
				{@const chipGroups = splitChips(chipsFor(v.row.commit.refs))}
				{@const parsed = parseSubject(v.row.commit.subject)}
				<div
					class="row"
					class:selected={v.row.commit.hash === selectedHash || setSelected.has(v.row.commit.hash)}
					class:compared={v.row.commit.hash === compareHash}
					class:merge-muted={muteMerges && v.row.commit.parents.length > 1}
					class:find-match={setFindMatches.has(v.row.commit.hash)}
					class:find-current={v.row.commit.hash === findCurrent}
					style="top:{v.index * ROW_H}px; height:{ROW_H}px; grid-template-columns:{gridTemplate};
						padding-right:{SCROLL_GUTTER}px; min-width:{minGridW}px"
					role="button"
					tabindex="0"
					onclick={(event) => {
						if (event.shiftKey) onselectRange(v.row.commit.hash);
						else if (event.ctrlKey || event.metaKey) oncompare(v.row.commit.hash);
						else onselect(v.row.commit.hash);
					}}
					onmousedown={(event) => {
						// Shift-click must read as range selection, not as a text selection sweep.
						if (event.shiftKey) event.preventDefault();
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') onselect(v.row.commit.hash);
					}}
					oncontextmenu={(event) => openMenu(event, v.row.commit)}
					onmouseenter={() => {
						if (highlightHover) hoveredBranch = v.row.nodeBranch;
						if (showGhostBranch) hoveredRow = v.row.commit.hash;
					}}
					onmouseleave={() => {
						if (hoveredRow === v.row.commit.hash) hoveredRow = null;
					}}
				>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="refs"
						onmouseenter={(event) =>
							openRefExpand(
								event,
								v.row.commit,
								chipsFor(v.row.commit.refs),
								chipGroups.listOverflow.length > 0
							)}
						onmouseleave={scheduleExpandClose}
					>
						{#each chipGroups.listVisible as chip (chip.kind + chip.name)}
							{#if chip.kind === 'branch'}
								<button
									class="ref branch"
									class:current={chip.checkedOut}
									class:checkoutable={!chip.checkedOut}
									class:droppable={canDrop(chip)}
									class:drop-hover={dropTarget === chip.name}
									draggable="true"
									ondragstart={(event) => onChipDragStart(event, chip)}
									ondragend={endDrag}
									ondragover={(event) => onChipDragOver(event, chip)}
									ondragleave={() => {
										if (dropTarget === chip.name) dropTarget = null;
									}}
									ondrop={(event) => onChipDrop(event, chip)}
									oncontextmenu={(event) => openRefMenu(event, v.row.commit, chip)}
									ondblclick={(event) => {
										event.stopPropagation();
										if (chip.checkedOut) return;
										oncheckoutBranch(chip.hasLocal ? chip.name : null, chipRemote(chip));
									}}
									onkeydown={(event) => {
										if (event.key !== 'Enter' || chip.checkedOut) return;
										event.stopPropagation();
										oncheckoutBranch(chip.hasLocal ? chip.name : null, chipRemote(chip));
									}}
								>
									{@render chipBody(chip)}
								</button>
							{:else}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="ref {chip.kind}"
									use:tooltip={chip.title}
									oncontextmenu={(event) => openRefMenu(event, v.row.commit, chip)}
								>
									{@render chipBody(chip)}
								</span>
							{/if}
						{/each}
						{#if chipGroups.listOverflow.length > 0}
							<!-- A count, not a control: hovering anywhere in the cell now opens the column,
							     so the badge only has to say how much is being withheld. -->
							<span class="ref more"
								><span class="seg">+{chipGroups.listOverflow.length}</span></span
							>
						{/if}
						{#if showGhostBranch && (selectedHash === v.row.commit.hash || hoveredRow === v.row.commit.hash)}
							{@const ghost = ghostBranchFor(v.row, mapGhostNames)}
							{#if ghost}
								<!-- Not a chip: this ref is not *at* this commit, it is the line the commit is
								     drawn on. A chip would claim the branch points here. -->
								<button
									class="ghost"
									use:tooltip={ghost === currentBranch
										? `On the ${ghost} line — no ref points at this commit`
										: `On the ${ghost} line — double-click to check ${ghost} out`}
									ondblclick={(event) => {
										event.stopPropagation();
										if (ghost !== currentBranch) oncheckoutBranch(ghost, null);
									}}>{ghost}</button
								>
							{/if}
						{/if}
					</span>
					<span class="graph-cell"></span>
					<span class="subject" class:uncommitted={v.row.commit.isUncommitted}>
						{#if v.row.commit.signature}{@const look =
								MAP_SIGNATURE_LOOK[v.row.commit.signature]}<span
								class="signature {look.tone}"
								use:tooltip={look.label}><Icon name={look.icon} label={look.label} /></span
							>{/if}{#if showTypeBadge && v.row.commit.parents.length > 1}<span
								class="type"
								style="color:{typeColour('merge')}"
								use:tooltip={`Merge commit — ${v.row.commit.parents.length} parents`}>merge</span
							>{/if}{#if showTicketBadge && parsed.ticket}<span class="ticket">{parsed.ticket}</span
							>{/if}{#if showTypeBadge && parsed.type}<span
								class="type"
								style="color:{typeColour(parsed.type)}"
								>{parsed.type}{parsed.scope ? `(${parsed.scope})` : ''}</span
							>{/if}{subjectText(parsed)}
					</span>
					{#each listOrderedColumns as column (column.key)}
						{#if columns[column.key]}
							{@render optionalCell(column.key, v.row.commit)}
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

{#if refExpand}
	{@const expandCommit = refExpand.commit}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ref-expand"
		bind:clientWidth={expandWidth}
		style="right:{expandRight}px; top:{refExpand.y}px; visibility:{expandWidth > 0
			? 'visible'
			: 'hidden'}"
		onmouseenter={cancelExpandClose}
		onmouseleave={scheduleExpandClose}
		oncontextmenu={(event) => event.preventDefault()}
	>
		{#each refExpand.listChips as chip (chip.kind + chip.name)}
			{#if chip.kind === 'branch'}
				<!-- The panel covers the chips it stands for, so it has to be where they are dragged
				     from and dropped onto — otherwise opening it would take the merge gesture away. -->
				<button
					class="ref branch expand-chip"
					class:current={chip.checkedOut}
					class:droppable={canDrop(chip)}
					class:drop-hover={dropTarget === chip.name}
					title="{chip.title} — double-click to check out"
					draggable="true"
					ondragstart={(event) => onChipDragStart(event, chip)}
					ondragend={endDrag}
					ondragover={(event) => onChipDragOver(event, chip)}
					ondragleave={() => {
						if (dropTarget === chip.name) dropTarget = null;
					}}
					ondrop={(event) => onChipDrop(event, chip)}
					oncontextmenu={(event) => openRefMenu(event, expandCommit, chip)}
					ondblclick={(event) => {
						event.stopPropagation();
						checkoutChip(chip);
					}}
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.stopPropagation();
						checkoutChip(chip);
					}}
				>
					{@render chipBody(chip)}
				</button>
			{:else}
				<span
					class="ref {chip.kind} expand-chip"
					title={chip.title}
					oncontextmenu={(event) => openRefMenu(event, expandCommit, chip)}
				>
					{@render chipBody(chip)}
				</span>
			{/if}
		{/each}
	</div>
{/if}

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		items={menuItems}
		onselect={onMenuSelect}
		onclose={closeMenu}
	/>
{/if}

{#if dropMenu}
	<ContextMenu
		x={dropMenu.x}
		y={dropMenu.y}
		items={dropMenuItems}
		onselect={onDropMenuSelect}
		onclose={() => (dropMenu = null)}
	/>
{/if}

{#if headerMenu}
	<ContextMenu
		x={headerMenu.x}
		y={headerMenu.y}
		items={headerMenuItems}
		onselect={(id) => {
			headerMenu = null;
			ontoggleColumn(id);
		}}
		onclose={() => (headerMenu = null)}
	/>
{/if}

<style>
	.graph-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	/* The strip never spills past the graph — onto the details panel, where it could neither be
	   seen nor dragged. Scrolled from script, in step with the rows. */
	.headers-clip {
		flex: none;
		overflow: hidden;
	}
	.headers {
		position: relative;
		isolation: isolate;
		display: grid;
		gap: var(--gg-space-2);
		flex: none;
		height: var(--gg-header-h);
		box-sizing: border-box;
		border-bottom: 1px solid var(--gg-seam);
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	/* The header is a soft strip in from the pane edge, lined up with the inset rows below it. */
	.headers::before {
		content: '';
		position: absolute;
		inset: 2px var(--gg-row-inset);
		z-index: -1;
		border-radius: var(--gg-radius);
		background: var(--gg-tint);
	}
	/* Each label starts where its column's text starts; Date, whose values hang right, ends with them. */
	.hcell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		white-space: nowrap;
		min-width: 0;
	}
	.hcell:first-child {
		padding-left: var(--gg-space-2);
	}
	.hcell.end {
		justify-content: flex-end;
	}
	.hlabel {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hlabel.movable {
		cursor: grab;
	}
	/* While a column label is being dragged, every other optional column is a place it can land. */
	.hcell.drop-column {
		outline: 1px dashed var(--gg-focus);
		outline-offset: -2px;
	}
	/* Sits in the grid gap so the divider line lands exactly between two columns. */
	.grip {
		position: absolute;
		right: calc(var(--gg-space-2) * -1);
		top: 0;
		bottom: 0;
		width: var(--gg-space-2);
	}
	.grip.left {
		right: auto;
		left: calc(var(--gg-space-2) * -1);
	}
	.grip::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 4px;
		bottom: 4px;
		width: 1px;
		background: var(--gg-border);
	}
	.grip.resizable {
		cursor: col-resize;
	}
	.grip.resizable:hover::after,
	.grip.active::after {
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--gg-accent);
	}
	.scroll {
		flex: 1;
		overflow: auto;
		position: relative;
		min-height: 0;
	}
	.inner {
		position: relative;
	}
	.lines {
		position: absolute;
		top: 0;
		overflow: visible;
		pointer-events: none;
		/* Above the rows: their hover/selection backgrounds are opaque theme colours, and under
		   them a row would cut its slice out of every lane. The svg only spans the graph column,
		   so it covers no row text, and pointer-events keeps the rows clickable through it. */
		z-index: 1;
	}
	.lines path,
	.lines g {
		transition: opacity 120ms ease-out;
	}
	.lines path.dim,
	.lines g.dim {
		opacity: 0.22;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		box-sizing: border-box;
		display: grid;
		align-items: center;
		gap: var(--gg-space-2);
		cursor: pointer;
		white-space: nowrap;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		font: inherit;
		/* Below the graph lines (z-index 1) but a stacking context of its own, so the highlight layer
		   can sit behind the row's text without dropping behind the viewport underneath it. */
		z-index: 0;
	}
	/* The highlight is a layer inset from the row, not the row's own background: that is what buys
	   the gutter and the rounded corners without a border shifting the column grid. */
	.row::before {
		content: '';
		position: absolute;
		inset: 2px var(--gg-row-inset);
		z-index: -1;
		border-radius: var(--gg-radius);
		pointer-events: none;
		/* Short enough that the row still feels like it lights up under the pointer, not after it. */
		transition: background-color 60ms var(--gg-ease);
	}
	.row:hover::before {
		background: var(--gg-bg-hover);
	}
	.row.selected::before {
		background: var(--gg-bg-selected);
	}
	.row.selected {
		color: var(--gg-fg-selected);
	}
	.row.selected .subject,
	.row.selected .muted {
		color: inherit;
	}
	/* Under the selection: a selected match reads as selected, the find colour returns once it moves on. */
	.row.find-match:not(.selected)::before {
		background: var(--gg-find-highlight-bg);
	}
	.row.find-current:not(.selected)::before {
		background: var(--gg-find-bg);
	}
	.row.find-current::before {
		outline: 1px solid var(--gg-find-border);
		outline-offset: -1px;
	}
	/* On the highlight layer, so the compare marker traces the same inset rounded rect. */
	.row.compared::before {
		outline: 1px dashed var(--gg-accent);
		outline-offset: -1px;
	}
	/* Muted, not hidden: the merge stays readable when you look for it, invisible when you don't. */
	.row.merge-muted .subject,
	.row.merge-muted .muted {
		opacity: 0.45;
	}
	.refs {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		overflow: hidden;
		padding-left: var(--gg-space-2);
		justify-content: flex-end;
		/* Chips are drag handles, not text: a drag must never turn into a text selection. */
		user-select: none;
	}
	.ref {
		display: inline-flex;
		/* Segments stretch to the chip's full height, so their dividers run edge to edge. */
		align-items: stretch;
		min-width: 0;
		flex: 0 1 auto;
		font-size: var(--gg-text-sm);
		line-height: 18px;
		/* Fixed, not a minimum: an icon's line box must never make one chip taller than its neighbour.
		   Border-box so the border and any padding a variant adds come out of this height rather than
		   on top of it — otherwise the one chip that pads itself stands taller than the rest. */
		box-sizing: border-box;
		height: 20px;
		border-radius: var(--gg-radius);
		border: 1px solid var(--gg-chip-border);
		background: var(--gg-chip-bg);
		/* Keeps a long name clipped inside the rounded corners. */
		overflow: hidden;
	}
	.ref .seg {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 5px;
		min-width: 0;
	}
	/* Indicators share one fixed box so the icons line up down the column, whatever the name width. */
	.ref .seg.indicator {
		flex: none;
		justify-content: center;
		width: 18px;
		padding: 0;
		color: var(--gg-fg-muted);
	}
	/* The drift reads in the accent colour, the same ↑N ↓N as on the Pull / Push buttons. */
	.ref .seg.tracking {
		flex: none;
		gap: 3px;
		padding-left: 2px;
		color: var(--gg-accent);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		font-size: var(--gg-text-sm);
		/* Same flex baseline as every other seg: the arrows are glyphs and would otherwise ride up. */
		align-items: center;
	}
	.ref .seg.tracking.gone {
		color: var(--gg-danger);
		text-transform: uppercase;
		font-size: var(--gg-text-xs);
		letter-spacing: 0.04em;
	}
	.ref .drift {
		display: inline-flex;
		align-items: center;
	}
	/* No border, no background: a ghost has to read as "this line" rather than as one more ref. */
	.ghost {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		cursor: default;
		display: inline-flex;
		align-items: center;
		height: var(--gg-hit);
		padding: 0 4px;
		font-style: italic;
		opacity: 0.55;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* A tag or stash leads with its icon in its own colour; the chip body stays the same neutral grey
	   as every other ref, so colour in this column means a kind of ref, never a lane. */
	.ref .glyph {
		flex: none;
		display: inline-flex;
		align-items: center;
		padding-left: 5px;
		color: var(--gg-fg-muted);
	}
	.ref.tag .glyph {
		color: var(--gg-tag);
	}
	.ref.stash .glyph {
		color: var(--gg-stash);
	}
	.ref .glyph :global(.codicon) {
		font-size: var(--gg-icon-sm);
		opacity: 1;
	}
	/* Detached HEAD is a state to get out of, not a ref to admire — it borrows the warning colour
	   rather than a lane colour, so it never reads as one more branch on the row. */
	.ref.head {
		border-color: var(--gg-warning);
		color: var(--gg-warning);
		font-weight: 600;
	}
	.ref.head .glyph {
		color: inherit;
	}
	.ref-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A <button> falls back to the browser's own font; only the family needs restoring, since
	   `font: inherit` would also drop the chip's size and line height. */
	.ref.branch {
		font-family: inherit;
		color: inherit;
		cursor: grab;
		padding: 0;
	}
	.ref.branch:hover {
		background: var(--gg-bg-hover);
	}
	/* Where the dragged branch may land, and the one it would land on right now. */
	.ref.droppable {
		border-color: var(--gg-accent);
		border-style: dashed;
	}
	.ref.drop-hover {
		border-style: solid;
		background: var(--gg-bg-drop);
	}
	/* The checked-out branch is the one chip that takes the accent: ring, tint and its check mark. */
	.ref.current {
		border-color: var(--gg-accent);
		background: color-mix(in srgb, var(--gg-accent) 14%, transparent);
	}
	.ref.current .ref-name {
		font-weight: 600;
	}
	.ref .check {
		display: inline-flex;
		color: var(--gg-accent);
	}
	.ref.current :global(.codicon) {
		opacity: 1;
	}
	/* Padded through a `.seg` like every other chip, rather than padding itself: a chip that carries
	   its own padding is the one that ends up a different size from its neighbours. */
	.ref.more {
		flex: none;
		color: var(--gg-fg-muted);
	}
	/* The expanded ref column: every chip of one row, stacked, each behaving like the chip it stands
	   for.

	   Opaque, and on a panel. Bare chips floating over the graph read well in isolation, but this
	   hangs down over the rows below its own, and chips from two different commits overlapping at
	   the same height read as one row carrying both — the one thing the graph must never say. Below
	   `ContextMenu` in the stack, so a menu opened from a chip in here draws on top. */
	.ref-expand {
		position: fixed;
		z-index: 5;
		display: flex;
		flex-direction: column;
		/* Each chip is as wide as it needs to be, hung off the right edge — the same shape they have
		   in the row. Stretching them to the widest name would invent a size none of them has. */
		align-items: flex-end;
		gap: var(--gg-space-1);
		padding: var(--gg-space-1);
		border-radius: var(--gg-radius-lg);
		background: var(--gg-menu-bg);
		border: 1px solid var(--gg-menu-border);
		box-shadow: var(--gg-shadow);
	}
	/* The panel behind them is opaque, so these only need to read as chips against it — the same
	   lift a chip has against a row, left alone rather than tuned for a second background. */
	.expand-chip {
		justify-content: flex-start;
		background: color-mix(in srgb, var(--gg-fg) 12%, var(--gg-bg));
	}
	.ref :global(.codicon) {
		flex: none;
		font-size: var(--gg-icon-sm);
		opacity: 0.9;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subject.uncommitted {
		font-weight: 600;
	}
	.signature {
		display: inline-flex;
		vertical-align: middle;
		margin-right: var(--gg-space-1);
	}
	.signature :global(.codicon) {
		font-size: var(--gg-icon-sm);
	}
	.signature.good {
		color: var(--gg-success);
	}
	.signature.warn {
		color: var(--gg-warning);
	}
	.signature.bad {
		color: var(--gg-danger);
	}
	/* A soft tint of the type's own colour, with no outline: one quiet block per row, so the subject
	   is still what the eye lands on. The hue comes from the theme, tuned for its background. */
	.type {
		display: inline-block;
		margin-right: var(--gg-space-1);
		padding: var(--gg-chip-padding);
		border-radius: var(--gg-radius);
		background: color-mix(in srgb, currentColor 15%, transparent);
		font-size: var(--gg-text-sm);
		line-height: var(--gg-chip-line-height);
		font-weight: 600;
		vertical-align: 1px;
	}
	/* A lookup key rather than a label: plain muted code text, no box. */
	.ticket {
		margin-right: var(--gg-space-1);
		color: var(--gg-fg-muted);
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-xs);
	}
	.head-halo {
		opacity: 0.4;
	}
	.muted {
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mono {
		font-family: var(--gg-font-mono);
	}
	.author {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
	}
	.avatar {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.date {
		text-align: right;
	}
	/* Monospace keeps the date parts in the same place on every row. */
	.muted.date {
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-xs);
	}
	.changes {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		min-width: 0;
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-xs);
	}
	/* The gauge takes what the counts leave, so a narrow column drops the bar before the numbers. */
	.gauge {
		flex: 0 1 auto;
		max-width: 40%;
		min-width: 3px;
		height: 6px;
		overflow: hidden;
		border-radius: var(--gg-radius-xs);
		background: var(--gg-deleted);
	}
	.gauge-added {
		display: block;
		height: 100%;
		background: var(--gg-added);
	}
	.added {
		color: var(--gg-added);
	}
	.removed {
		color: var(--gg-deleted);
	}
</style>
