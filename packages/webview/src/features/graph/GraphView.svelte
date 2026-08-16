<script lang="ts">
	import type { BranchActionId, Commit, CommitActionId, GraphRow, Ref } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import {
		branchOut,
		intoNode,
		laneX,
		mergeIn,
		outOfNode,
		passThrough,
		type LaneMetrics,
	} from '../../lib/graphPath';
	import type { ParsedSubject } from '../../lib/commitSubject';
	import { formatSubject, parseSubject, typeColour } from '../../lib/commitSubject';
	import type { RefChip } from '../../lib/graphChips';
	import { buildChips, splitChips } from '../../lib/graphChips';
	import type { DateFormat } from '../../lib/commitDate';
	import { formatCommitDate } from '../../lib/commitDate';
	import { isSquashableChain } from '../../lib/squashRange';
	import { tooltip } from '../../lib/ui/tooltip';
	import ContextMenu, { type MenuItem } from '../../lib/ui/ContextMenu.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import RefIcon from '../../lib/ui/RefIcon.svelte';
	import type { DateType, GraphStyle, RowDensity } from '../settings/SettingsWidget.svelte';

	export interface ColumnVisibility {
		author: boolean;
		commit: boolean;
		date: boolean;
	}

	/** User-resizable column widths, in pixels. */
	export interface ColumnWidths {
		ref: number;
		author: number;
		commit: number;
		date: number;
	}

	export type ColumnKey = keyof ColumnWidths;

	let {
		rows,
		selectedHash,
		listSelectedHashes,
		currentBranch,
		lastPicked,
		columns,
		widths,
		compareHash,
		dateFormat,
		dateType,
		graphStyle,
		rowDensity,
		highlightHover,
		muteMerges,
		showTicketBadge,
		showTypeBadge,
		fastForward,
		scrollTarget,
		hasMore,
		onselect,
		onselectRange,
		oncompare,
		oncheckoutBranch,
		onaction,
		onmulti,
		onloadMore,
		onbranchAction,
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
		dateFormat: DateFormat;
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
		/** The host's answer to the last fast-forward question, matched by nonce. */
		fastForward: { nonce: number; canFastForward: boolean } | null;
		/** Bumping `nonce` scrolls the given hash into view. */
		scrollTarget: { hash: string; nonce: number } | null;
		/** Whether history continues past the loaded rows — scrolling near the bottom loads more. */
		hasMore: boolean;
		onselect: (hash: string) => void;
		/** Shift-click: extend the selection from the anchor to this commit. */
		onselectRange: (hash: string) => void;
		oncompare: (hash: string) => void;
		/** Check out a branch chip: a local name when there is one, otherwise a remote-tracking one. */
		oncheckoutBranch: (local: string | null, remote: string | null) => void;
		onaction: (action: CommitActionId, commit: Commit) => void;
		/** Act on the multi-selected commits (newest → oldest). */
		onmulti: (action: 'squash' | 'drop' | 'cherryPick' | 'revert', listHashes: string[]) => void;
		onloadMore: () => void;
		/** One branch chip dropped onto another: merge, rebase or fast-forward. */
		onbranchAction: (action: BranchActionId, source: string, target: string) => void;
		oncheckFastForward: (source: string, target: string, nonce: number) => void;
		ontoggleColumn: (column: keyof ColumnVisibility) => void;
		onresizeColumn: (column: ColumnKey, width: number) => void;
	} = $props();

	/**
	 * Row heights per density. Every step stays taller than the text needs, so the lane curves keep
	 * room to read as smooth transitions rather than corners.
	 */
	const mapRowHeight: Record<RowDensity, number> = {
		compact: 26,
		comfortable: 34,
		spacious: 44,
	};
	const ROW_H = $derived(mapRowHeight[rowDensity]);
	const COL_W = 20;
	const PAD = 12;
	const NODE_R = 5;
	/** Radius used when a commit shows its author's avatar instead of a plain dot. */
	const AVATAR_R = 9;
	/** Lane lines are drawn hairline-thin: a graph this dense turns to mush at any real weight. */
	const EDGE_W = 1.5;
	/** How far a lane's corner is rounded off when it changes column. */
	const CURVE = 8;
	/** Codicon glyph for `archive`, drawn inside the stash node. */
	const STASH_GLYPH = '';
	const OVERSCAN = 8;
	const MIN_COL_W = 60;

	/** Breathing room so the overlay scrollbar never sits on top of the Date column. */
	const SCROLL_GUTTER = 8;

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	let viewportW = $state(0);

	/** Branch-line under the pointer: every other branch's lanes and nodes dim while it is set. */
	let hoveredBranch = $state<number | null>(null);

	/** The ref being dragged — a local branch name, or a remote-tracking one like "origin/main". */
	let dragSource = $state<string | null>(null);
	/** The local branch under the pointer, i.e. where dropping would land. */
	let dropTarget = $state<string | null>(null);
	let dropMenu = $state<{ x: number; y: number; source: string; target: string } | null>(null);
	/** Identifies the fast-forward question asked for the current drop, so stale answers are ignored. */
	let ffNonce = $state(0);

	/**
	 * Width the scrollbar takes out of the scroll area (0 for macOS overlay scrollbars). The header
	 * sits outside that area, so it needs the same inset to stay aligned with the rows.
	 */
	const scrollbarW = $derived(viewport && viewportW ? viewport.offsetWidth - viewportW : 0);
	let menu = $state<{ x: number; y: number; commit: Commit } | null>(null);
	let headerMenu = $state<{ x: number; y: number } | null>(null);
	let resizing = $state<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

	const cols = $derived(graphWidth(rows));
	const graphPx = $derived(cols * COL_W + PAD);
	const totalH = $derived(rows.length * ROW_H);
	const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
	const end = $derived(
		Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
	);
	const visible = $derived(rows.slice(start, end).map((row, k) => ({ row, index: start + k })));

	const gridTemplate = $derived(
		[
			`${widths.ref}px`,
			`${graphPx}px`,
			'1fr',
			columns.author ? `${widths.author}px` : '',
			columns.commit ? `${widths.commit}px` : '',
			columns.date ? `${widths.date}px` : '',
		]
			.filter((part) => part !== '')
			.join(' ')
	);

	const headerMenuItems = $derived([
		{ id: 'author', label: `${columns.author ? '✓ ' : '   '}Author` },
		{ id: 'commit', label: `${columns.commit ? '✓ ' : '   '}Commit` },
		{ id: 'date', label: `${columns.date ? '✓ ' : '   '}Date` },
	]);

	const metrics = $derived<LaneMetrics>({
		columnWidth: COL_W,
		rowHeight: ROW_H,
		padding: PAD,
		curve: CURVE,
		style: graphStyle,
	});

	interface LaneSegment {
		d: string;
		colour: number;
		/** Branch-line identity, for hover highlighting. */
		branch: number;
		/** Leaves this row's node, so a stash can draw its line dashed. */
		fromNode: boolean;
	}

	/**
	 * Every line to draw in one row's band, from its lanes alone.
	 *
	 * A lane keeps its column for its whole life, so a column changes hands only at a node: either a
	 * lane arrives here and is consumed, or one starts here for a parent. That leaves four shapes and
	 * no cross-row questions.
	 */
	function laneSegments(row: GraphRow): LaneSegment[] {
		const listSegments: LaneSegment[] = [];
		const node = row.nodeColumn;
		const hash = row.commit.hash;
		for (let column = 0; column < row.listInputLanes.length; column++) {
			const input = row.listInputLanes[column] ?? null;

			if (input && input.hash !== hash) {
				// Not this commit's lane, so it crosses the whole band untouched.
				listSegments.push({
					d: passThrough(column, metrics),
					colour: input.colour,
					branch: input.branch,
					fromNode: false,
				});
				continue;
			}
			if (input) {
				listSegments.push(
					column === node
						? {
								d: intoNode(column, metrics),
								colour: input.colour,
								branch: input.branch,
								fromNode: false,
							}
						: {
								d: mergeIn(column, node, metrics),
								colour: input.colour,
								branch: input.branch,
								fromNode: false,
							}
				);
			}
		}

		// The lines out of the node, one per parent. Driven by the parent columns rather than by the
		// output lanes: a parent another lane already awaits opens no lane of its own, so the lanes
		// alone would leave this commit with no way down.
		for (const column of row.listParentColumns) {
			const lane = row.listOutputLanes[column];
			const colour = lane?.colour ?? row.nodeColour;
			const branch = lane?.branch ?? row.nodeBranch;
			listSegments.push(
				column === node
					? { d: outOfNode(column, metrics), colour, branch, fromNode: true }
					: { d: branchOut(node, column, metrics), colour, branch, fromNode: true }
			);
		}
		return listSegments;
	}

	/** Chips of one commit, ordered and collapsed by the pure helper in `lib/graphChips`. */
	const chipsFor = (refs: Ref[]): RefChip[] => buildChips(refs, currentBranch, lastPicked);

	/**
	 * The `+N` popover: where to draw it and which chips it holds. Anchored by its right edge, so
	 * the hidden chips hang in one flush column however long their names run.
	 */
	let chipPopover = $state<{ right: number; y: number; listChips: RefChip[] } | null>(null);
	let chipCloseTimer: ReturnType<typeof setTimeout> | undefined;

	function openChipPopover(event: MouseEvent, listChips: RefChip[]): void {
		clearTimeout(chipCloseTimer);
		const badge = event.currentTarget as HTMLElement;
		// Lined up with the chip the badge follows, not with the badge itself: the chips it hides are
		// the same kind of thing as that chip, so they read as a column continuing under it.
		const anchor = badge.previousElementSibling ?? badge;
		chipPopover = {
			right: window.innerWidth - anchor.getBoundingClientRect().right,
			y: badge.getBoundingClientRect().bottom + 2,
			listChips,
		};
	}

	/** Delayed, so the pointer can travel from the badge into the popover without it vanishing. */
	function scheduleChipClose(): void {
		clearTimeout(chipCloseTimer);
		chipCloseTimer = setTimeout(() => (chipPopover = null), 150);
	}

	function cancelChipClose(): void {
		clearTimeout(chipCloseTimer);
	}

	function checkoutChip(chip: RefChip): void {
		chipPopover = null;
		if (chip.checkedOut) return;
		oncheckoutBranch(
			chip.hasLocal ? chip.name : null,
			chip.listRemotes.length > 0 ? `${chip.listRemotes[0]}/${chip.name}` : null
		);
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

	const fmtDate = (epochSeconds: number): string => formatCommitDate(epochSeconds, dateFormat);

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

	/** The ref a chip stands for: its local name when it has one, else its first remote-tracking one. */
	function chipRef(chip: RefChip): string | null {
		if (chip.hasLocal) return chip.name;
		const remote = chip.listRemotes[0];
		return remote ? `${remote}/${chip.name}` : null;
	}

	/**
	 * Only a local branch can be dropped onto: Git writes the target ref, and a remote-tracking ref
	 * is a copy of someone else's, not something this repository may move.
	 */
	function isDropTarget(chip: RefChip): boolean {
		return (
			dragSource !== null && chip.kind === 'branch' && chip.hasLocal && chip.name !== dragSource
		);
	}

	function onChipDragStart(event: DragEvent, chip: RefChip): void {
		const source = chipRef(chip);
		if (!source) {
			event.preventDefault();
			return;
		}
		dragSource = source;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'copy';
			event.dataTransfer.setData('text/plain', source);
		}
	}

	function onChipDragOver(event: DragEvent, chip: RefChip): void {
		if (!isDropTarget(chip)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropTarget = chip.name;
	}

	function onChipDrop(event: DragEvent, chip: RefChip): void {
		if (!isDropTarget(chip) || !dragSource) return;
		event.preventDefault();
		event.stopPropagation();
		dropMenu = { x: event.clientX, y: event.clientY, source: dragSource, target: chip.name };
		ffNonce += 1;
		// The answer decides whether the menu offers a fast-forward; it lands while the menu is open.
		oncheckFastForward(dragSource, chip.name, ffNonce);
		dragSource = null;
		dropTarget = null;
	}

	function endDrag(): void {
		dragSource = null;
		dropTarget = null;
	}

	const dropMenuItems = $derived.by(() => {
		if (!dropMenu) return [];
		const items = [
			{ id: 'mergeInto', label: `Merge ${dropMenu.source} into ${dropMenu.target}…` },
			{ id: 'rebaseOnto', label: `Rebase ${dropMenu.source} onto ${dropMenu.target}…` },
		];
		if (fastForward?.nonce === ffNonce && fastForward.canFastForward) {
			items.push({
				id: 'fastForward',
				label: `Fast-forward ${dropMenu.target} to ${dropMenu.source}`,
			});
		}
		return items;
	});

	function onDropMenuSelect(id: string): void {
		const drop = dropMenu;
		dropMenu = null;
		if (drop) onbranchAction(id as BranchActionId, drop.source, drop.target);
	}

	const menuItems = $derived.by(() => {
		if (!menu) return [];
		// A right-click inside the multi-selection acts on the range, not the single commit.
		if (listSelectedCommits.length > 1 && setSelected.has(menu.commit.hash)) {
			const n = listSelectedCommits.length;
			const chain = isSquashableChain(listSelectedCommits);
			// Cherry-pick and revert replay commits one by one, so they only need merge-free picks,
			// not a contiguous chain.
			const noMerges = listSelectedCommits.every((commit) => commit.parents.length === 1);
			const items: MenuItem[] = [
				{ id: 'squashSelected', label: `Squash ${n} Commits…`, disabled: !chain },
				{ id: 'dropSelected', label: `Drop ${n} Commits…`, disabled: !chain },
				{
					id: 'cherryPickSelected',
					label: `Cherry Pick ${n} Commits…`,
					disabled: !noMerges,
					separatorBefore: true,
				},
				{ id: 'revertSelected', label: `Revert ${n} Commits…`, disabled: !noMerges },
			];
			if (!chain) {
				items.push({
					id: 'multiHint',
					label: noMerges
						? 'Squash/Drop need a consecutive run on one branch'
						: 'Selection contains merge commits',
					disabled: true,
					separatorBefore: true,
				});
			}
			return items;
		}
		const stashRef = menu.commit.refs.find((r) => r.kind === 'stash');
		if (stashRef) {
			return [
				{ id: 'stashApply', label: 'Apply Stash…' },
				{ id: 'stashPop', label: 'Pop Stash…' },
				{ id: 'stashBranch', label: 'Create Branch from Stash…' },
				{ id: 'stashDrop', label: 'Drop Stash…', separatorBefore: true },
				{ id: 'copyHash', label: 'Copy Commit Hash', separatorBefore: true },
				{ id: 'copySubject', label: 'Copy Subject' },
			];
		}
		const hasLocalBranch = menu.commit.refs.some((r) => r.kind === 'branch' && !r.remote);
		// Naming the branch beats "current branch": on a graph of many branches it is the one thing
		// the reader cannot infer from where they right-clicked.
		const here = currentBranch ?? 'the current branch';
		const items: MenuItem[] = [
			{ id: 'checkout', label: 'Checkout Commit' },
			{ id: 'createBranch', label: 'Create Branch…' },
			{ id: 'addTag', label: 'Add Tag…' },
			{ id: 'merge', label: `Merge into ${here}…`, separatorBefore: true },
			{ id: 'rebase', label: `Rebase ${here} on this Commit…` },
			{ id: 'cherryPick', label: 'Cherry Pick…' },
			{ id: 'revert', label: 'Revert…' },
			{ id: 'reword', label: 'Reword Message…' },
			{
				id: 'reset',
				label: `Reset ${here} to this Commit`,
				children: [
					{ id: 'resetSoft', label: 'Soft — keep all changes, staged' },
					{ id: 'resetMixed', label: 'Mixed — keep changes, unstaged' },
					{ id: 'resetHard', label: 'Hard — discard all changes' },
				],
			},
		];
		const hasRemoteBranch = menu.commit.refs.some((r) => r.kind === 'branch' && r.remote);
		if (hasLocalBranch)
			items.push({ id: 'deleteBranch', label: 'Delete Branch…', separatorBefore: true });
		if (hasRemoteBranch) {
			items.push({
				id: 'checkoutRemote',
				label: 'Checkout Remote Branch…',
				separatorBefore: !hasLocalBranch,
			});
			items.push({ id: 'fetchIntoLocal', label: 'Fetch into local branch…' });
			items.push({ id: 'deleteRemoteBranch', label: 'Delete Remote Branch…' });
		}
		const hasTags = menu.commit.refs.some((r) => r.kind === 'tag');
		if (hasTags) {
			items.push({ id: 'pushTag', label: 'Push Tag…', separatorBefore: true });
			items.push({ id: 'deleteTag', label: 'Delete Tag…' });
			items.push({ id: 'deleteRemoteTag', label: 'Delete Remote Tag…' });
		}
		items.push({ id: 'openOnRemote', label: 'Open on Remote', separatorBefore: true });
		items.push({ id: 'copyRemoteUrl', label: 'Copy Remote URL' });
		items.push({ id: 'copyHash', label: 'Copy Commit Hash' });
		items.push({ id: 'copySubject', label: 'Copy Subject' });
		return items;
	});

	const mapMultiAction: Record<string, 'squash' | 'drop' | 'cherryPick' | 'revert'> = {
		squashSelected: 'squash',
		dropSelected: 'drop',
		cherryPickSelected: 'cherryPick',
		revertSelected: 'revert',
	};

	function onMenuSelect(id: string): void {
		const commit = menu?.commit;
		menu = null;
		const multiAction = mapMultiAction[id];
		if (multiAction) {
			onmulti(
				multiAction,
				listSelectedCommits.map((selected) => selected.hash)
			);
			return;
		}
		if (commit) onaction(id as CommitActionId, commit);
	}

	/** Row count the last load-more was asked at, so one scroll position asks only once. */
	let loadMoreAskedAt = 0;

	function onScroll(): void {
		if (!viewport) return;
		scrollTop = viewport.scrollTop;
		// Anchored to a screen position, so any scroll leaves it floating over the wrong row.
		chipPopover = null;
		if (!hasMore || rows.length === loadMoreAskedAt) return;
		if (scrollTop + viewportH >= totalH - ROW_H * 5) {
			loadMoreAskedAt = rows.length;
			onloadMore();
		}
	}

	function startResize(key: ColumnKey, event: MouseEvent): void {
		event.preventDefault();
		resizing = { key, startX: event.clientX, startWidth: widths[key] };
	}

	/** The Date column is the last one, so its handle sits on its left edge and inverts the delta. */
	function onResizeMove(event: MouseEvent): void {
		if (!resizing) return;
		const delta = event.clientX - resizing.startX;
		const signed = resizing.key === 'date' ? -delta : delta;
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

<svelte:window onmousemove={onResizeMove} onmouseup={() => (resizing = null)} />

{#snippet chipBody(chip: RefChip, colour: string)}
	{#if chip.kind !== 'branch'}
		<span class="glyph" style="background:{colour}">
			<Icon name={chip.kind === 'tag' ? 'tag' : 'archive'} />
		</span>
	{/if}
	<span class="seg">
		{#if chip.checkedOut}<RefIcon name="check" size={12} />{/if}
		<span class="ref-name">{chip.name}</span>
	</span>
	{#if chip.hasLocal}
		<span class="seg indicator"><RefIcon name="device-desktop" /></span>
	{/if}
	{#if chip.listRemotes.length > 0}
		<!-- The divider marks where the local half of a combined chip ends, so a remote-only chip
		     carries none. -->
		<span class="seg indicator" class:divided={chip.hasLocal}><RefIcon name="cloud" /></span>
	{/if}
{/snippet}

<div class="graph-view">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="headers"
		style="grid-template-columns:{gridTemplate}; padding-right:{SCROLL_GUTTER + scrollbarW}px"
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
			<span class="grip"></span>
		</span>
		<span class="hcell">
			<span class="hlabel">Description</span>
			{#if columns.author || columns.commit || columns.date}<span class="grip"></span>{/if}
		</span>
		{#if columns.author}
			<span class="hcell">
				<span class="hlabel">Author</span>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="grip resizable"
					class:active={resizing?.key === 'author'}
					title="Drag to resize the Author column"
					onmousedown={(event) => startResize('author', event)}
				></span>
			</span>
		{/if}
		{#if columns.commit}
			<span class="hcell">
				<span class="hlabel">Commit</span>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="grip resizable"
					class:active={resizing?.key === 'commit'}
					title="Drag to resize the Commit column"
					onmousedown={(event) => startResize('commit', event)}
				></span>
			</span>
		{/if}
		{#if columns.date}
			<span class="hcell">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="grip left resizable"
					class:active={resizing?.key === 'date'}
					title="Drag to resize the Date column"
					onmousedown={(event) => startResize('date', event)}
				></span>
				<span class="hlabel">Date</span>
			</span>
		{/if}
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
		<div class="inner" style="height:{totalH}px">
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
						{#each laneSegments(v.row) as segment, s (s)}
							<path
								d={segment.d}
								class:dim={hoveredBranch !== null && segment.branch !== hoveredBranch}
								stroke={graphColour(segment.colour)}
								stroke-width={EDGE_W}
								stroke-linecap="round"
								stroke-dasharray={isStash && segment.fromNode ? '3 3' : undefined}
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
					style="top:{v.index * ROW_H}px; height:{ROW_H}px; grid-template-columns:{gridTemplate};
						padding-right:{SCROLL_GUTTER}px"
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
					}}
				>
					<span class="refs">
						{#each chipGroups.listVisible as chip (chip.kind + chip.name)}
							{@const chipColour = graphColour(v.row.nodeColour)}
							<!-- Only the checked-out chip takes the branch colour: it is the one fact worth
							     spending colour on in a column of otherwise identical grey chips. -->
							{@const border = chip.checkedOut ? `border-color:${chipColour}` : undefined}
							{#if chip.kind === 'branch'}
								<button
									class="ref branch"
									class:current={chip.checkedOut}
									class:checkoutable={!chip.checkedOut}
									class:droppable={isDropTarget(chip)}
									class:drop-hover={dropTarget === chip.name}
									draggable="true"
									ondragstart={(event) => onChipDragStart(event, chip)}
									ondragend={endDrag}
									ondragover={(event) => onChipDragOver(event, chip)}
									ondragleave={() => {
										if (dropTarget === chip.name) dropTarget = null;
									}}
									ondrop={(event) => onChipDrop(event, chip)}
									ondblclick={(event) => {
										event.stopPropagation();
										if (chip.checkedOut) return;
										oncheckoutBranch(
											chip.hasLocal ? chip.name : null,
											chip.listRemotes.length > 0 ? `${chip.listRemotes[0]}/${chip.name}` : null
										);
									}}
									onkeydown={(event) => {
										if (event.key !== 'Enter' || chip.checkedOut) return;
										event.stopPropagation();
										oncheckoutBranch(
											chip.hasLocal ? chip.name : null,
											chip.listRemotes.length > 0 ? `${chip.listRemotes[0]}/${chip.name}` : null
										);
									}}
									style={border}
								>
									{@render chipBody(chip, chipColour)}
								</button>
							{:else}
								<span class="ref {chip.kind}" use:tooltip={chip.title} style={border}>
									{@render chipBody(chip, chipColour)}
								</span>
							{/if}
						{/each}
						{#if chipGroups.listOverflow.length > 0}
							<button
								class="ref more"
								onmouseenter={(event) => openChipPopover(event, chipGroups.listOverflow)}
								onmouseleave={scheduleChipClose}
								onclick={(event) => {
									event.stopPropagation();
									openChipPopover(event, chipGroups.listOverflow);
								}}
							>
								+{chipGroups.listOverflow.length}
							</button>
						{/if}
					</span>
					<span class="graph-cell"></span>
					<span class="subject" class:uncommitted={v.row.commit.isUncommitted}>
						{#if showTypeBadge && v.row.commit.parents.length > 1}<span
								class="type"
								style="color:{typeColour('merge')}; border-color:{typeColour('merge')}"
								use:tooltip={`Merge commit — ${v.row.commit.parents.length} parents`}>merge</span
							>{/if}{#if showTicketBadge && parsed.ticket}<span class="ticket">{parsed.ticket}</span
							>{/if}{#if showTypeBadge && parsed.type}<span
								class="type"
								style="color:{typeColour(parsed.type)}; border-color:{typeColour(parsed.type)}"
								>{parsed.type}{parsed.scope ? `(${parsed.scope})` : ''}</span
							>{/if}{subjectText(parsed)}
					</span>
					{#if columns.author}
						<span class="muted author">
							{#if v.row.commit.author.avatarUrl}
								<img class="avatar" src={v.row.commit.author.avatarUrl} alt="" />
							{/if}
							{v.row.commit.author.name}
						</span>
					{/if}
					{#if columns.commit}
						<span class="muted mono">
							{v.row.commit.isUncommitted ? '*' : v.row.commit.hash.slice(0, 8)}
						</span>
					{/if}
					{#if columns.date}
						<span class="muted date">
							{#if v.row.commit.isUncommitted}—{:else}{fmtDate(
									dateType === 'author' ? v.row.commit.authoredAt : v.row.commit.committedAt
								)}{/if}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>

{#if chipPopover}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chip-popover"
		style="right:{chipPopover.right}px; top:{chipPopover.y}px"
		onmouseenter={cancelChipClose}
		onmouseleave={scheduleChipClose}
	>
		{#each chipPopover.listChips as chip (chip.kind + chip.name)}
			<button
				class="ref branch popover-chip"
				class:current={chip.checkedOut}
				title="{chip.title} — double-click to check out"
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
				{@render chipBody(chip, 'var(--gg-accent)')}
			</button>
		{/each}
	</div>
{/if}

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		items={menuItems}
		onselect={onMenuSelect}
		onclose={() => (menu = null)}
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
			ontoggleColumn(id as keyof ColumnVisibility);
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
	.headers {
		display: grid;
		gap: var(--gg-space-2);
		flex: none;
		height: var(--gg-header-h);
		box-sizing: border-box;
		border-bottom: 1px solid var(--gg-border);
		color: var(--gg-fg-muted);
	}
	/*
	 * Every header label is centred over its column, whatever the cells below do. The header names a
	 * column rather than labelling any one value in it, so hanging them all on the same alignment
	 * reads as one strip; aligning each to its own content turned it into a ragged line.
	 */
	.hcell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		white-space: nowrap;
		min-width: 0;
	}
	.hlabel {
		overflow: hidden;
		text-overflow: ellipsis;
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
		border-radius: var(--gg-radius-item);
		/* Short enough that the row still feels like it lights up under the pointer, not after it. */
		transition: background-color 60ms var(--gg-ease);
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.row.selected {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.row.selected .subject,
	.row.selected .muted {
		color: inherit;
	}
	.row.compared {
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
		font-size: 12px;
		line-height: 18px;
		/* Fixed, not a minimum: an icon's line box must never make one chip taller than its neighbour. */
		height: 18px;
		border-radius: 5px;
		border: 1px solid var(--gg-chip-border);
		background: var(--gg-chip-bg);
		/* Keeps the tag/stash colour block inside the chip's rounded corners. */
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
		width: 20px;
		padding: 0;
	}
	.ref .seg.indicator.divided {
		border-left: 1px solid var(--gg-chip-border);
	}
	/* A tag or stash leads with its icon on a filled block, the way the branch colour reads on a node. */
	.ref .glyph {
		flex: none;
		display: inline-flex;
		align-items: center;
		padding: 0 4px;
		color: var(--gg-bg);
	}
	.ref .glyph :global(.codicon) {
		font-size: 13px;
		opacity: 1;
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
		background: var(--vscode-list-hoverBackground);
	}
	/* Where the dragged branch may land, and the one it would land on right now. */
	.ref.droppable {
		border-color: var(--gg-accent);
		border-style: dashed;
	}
	.ref.drop-hover {
		border-style: solid;
		background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground));
	}
	.ref.current .ref-name {
		font-weight: 600;
	}
	.ref.current :global(.codicon) {
		opacity: 1;
	}
	.ref.more {
		flex: none;
		color: var(--gg-fg-muted);
		align-items: center;
		padding: var(--gg-chip-padding);
		font-family: inherit;
		cursor: pointer;
	}
	.ref.more:hover {
		background: var(--vscode-list-hoverBackground);
		color: var(--gg-fg);
	}
	/* The `+N` popover: the hidden chips, stacked, each one behaving like the chip it stands for. */
	/* No panel behind the chips: they are the same chips as the row above, so a frame around them
	   only says "different kind of thing", which is the opposite of what they are. */
	.chip-popover {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--gg-space-1);
	}
	/* With nothing behind them, each chip has to be opaque on its own: the chip tint is deliberately
	   translucent, and the commit rows underneath would otherwise read straight through it. */
	.popover-chip {
		justify-content: flex-start;
		background: color-mix(in srgb, var(--gg-fg) 12%, var(--gg-bg));
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
	.ref :global(.codicon) {
		flex: none;
		font-size: 14px;
		opacity: 0.9;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subject.uncommitted {
		font-weight: 600;
	}
	/* Outlined rather than filled, so every colour stays legible on light and dark themes. */
	.ticket,
	.type {
		display: inline-block;
		margin-right: var(--gg-space-1);
		padding: var(--gg-chip-padding);
		border: 1px solid;
		border-radius: var(--gg-chip-radius);
		font-size: var(--gg-chip-font-size);
		line-height: var(--gg-chip-line-height);
		font-weight: 600;
		vertical-align: 1px;
	}
	.ticket {
		border-color: var(--gg-fg-muted);
		color: var(--gg-fg-muted);
	}
	.muted {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
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
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.8em;
	}
</style>
