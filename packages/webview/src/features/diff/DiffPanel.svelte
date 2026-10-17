<script lang="ts">
	import type { DiffHunk, SelectedDiffLine, WorkingDiffSide } from '@git-octopus/shared';
	import { blameLabel, buildBlameBlocks } from '../../lib/blameAnnotations';
	import type { BlameData } from '../../lib/stores/diffView.svelte';
	import { untrack } from 'svelte';
	import { computeRulerMarks } from '../../lib/diffRuler';
	import {
		buildDiffRows,
		isChangeRow,
		mapLinePartners,
		prefixLines,
		rowAtLine,
		rowColumns,
		rowLineCounts,
		rulerKind,
		pickKey,
		type DiffLayout,
		type DiffRow,
		type LineCell,
	} from '../../lib/diffRows';
	import type { HighlightToken } from '../../lib/highlight';
	import { applyRanges, intralineRanges, type CharRange } from '../../lib/intraline';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import ImageCompare from './ImageCompare.svelte';
	import LfsCard from './LfsCard.svelte';
	import SubmoduleCard from './SubmoduleCard.svelte';
	import type { ImageDiff, LfsDiff, SubmoduleDiffView } from '../../lib/stores/diffView.svelte';
	import { tooltip } from '../../lib/ui/tooltip';
	import type { DiffMode } from '../../lib/viewSettings';

	let {
		path,
		title,
		listHunks,
		listLineTokens,
		notice,
		loading,
		mode,
		layout = 'unified',
		wrap = false,
		ignoreWhitespace = false,
		intraline = true,
		tabSize = 4,
		image = null,
		lfs = null,
		submodule = null,
		blame = null,
		canTrace = false,
		staging = null,
		onmode,
		onlayout = () => {},
		onwrap = () => {},
		onwhitespace = () => {},
		onblame = () => {},
		onhistory = () => {},
		onrevealCommit = () => {},
		onstageLines = () => {},
		onopenSubmodule = () => {},
		onclose,
	}: {
		path: string;
		/** What is being diffed — a short hash, a range, or "Working Tree". */
		title: string;
		listHunks: DiffHunk[];
		/** Syntax tokens per line, in hunk order; null renders every line plain. */
		listLineTokens: HighlightToken[][] | null;
		notice: string | null;
		loading: boolean;
		mode: DiffMode;
		layout?: DiffLayout;
		/** Wrap long lines; split view wraps whatever this says. */
		wrap?: boolean;
		ignoreWhitespace?: boolean;
		/** Mark the words that changed inside an edited line. */
		intraline?: boolean;
		/** Columns one tab spans — the editor's `editor.tabSize`, so code lines up as it does there. */
		tabSize?: number;
		/** An image's sides, drawn in place of hunks. */
		image?: ImageDiff | null;
		/** What an LFS file's pointers name, in place of the pointer text. */
		lfs?: LfsDiff | null;
		/** A submodule's pointer move, in place of its "Subproject commit" lines. */
		submodule?: SubmoduleDiffView | null;
		/** Set while the panel shows the file's blame instead of its diff. */
		blame?: BlameData | null;
		/** The file has a revision to read history and blame from — false for an untracked file. */
		canTrace?: boolean;
		/** Which part of a working-tree file this is, when its lines can be staged or unstaged. */
		staging?: WorkingDiffSide | null;
		onmode: (mode: DiffMode) => void;
		onlayout?: (layout: DiffLayout) => void;
		onwrap?: () => void;
		onwhitespace?: () => void;
		onblame?: () => void;
		onhistory?: () => void;
		/** A blame annotation was clicked: bring that commit forward. */
		onrevealCommit?: (hash: string) => void;
		onstageLines?: (action: 'stage' | 'unstage' | 'discard', listLines: SelectedDiffLine[]) => void;
		/** Switch the view to the submodule's own repository. */
		onopenSubmodule?: (repoPath: string) => void;
		onclose: () => void;
	} = $props();

	const ROW_H = 18;
	const OVERSCAN = 20;
	const GUTTER_W = 44;
	const BLAME_W = 240;
	/** Sub-pixel rounding kept clear, so the count never runs a column past where the browser breaks. */
	const WRAP_SLACK_PX = 2;

	/**
	 * Hunks flattened into one list of rows, each hunk preceded by its own separator row. Drawing
	 * from a flat list is what lets the panel virtualise: a file shown whole is tens of thousands
	 * of rows, and only the screenful in view is ever in the DOM.
	 */
	/** Blame is the whole file in one column, whatever the diff layout is set to. */
	const effectiveLayout = $derived<DiffLayout>(blame ? 'unified' : layout);
	const listRows = $derived(
		buildDiffRows(listHunks, effectiveLayout, mode === 'compact' && blame === null)
	);

	/**
	 * Each edited line's counterpart, for marking the words that changed. Off under blame (no
	 * pairs) and under ignore-whitespace, where git's hunks no longer line up with the raw text.
	 */
	const mapPartners = $derived(
		intraline && blame === null && !ignoreWhitespace ? mapLinePartners(listHunks) : null
	);
	const listAllLines = $derived(listHunks.flatMap((hunk) => hunk.listLines));
	/**
	 * Ranges are worked out for the rows actually drawn and kept for this diff: comparing every
	 * pair up front would cost a large diff seconds it never shows.
	 */
	const mapEmphCache = $derived.by(() => {
		void mapPartners;
		return new Map<number, CharRange[]>();
	});

	function emphFor(lineIndex: number): CharRange[] {
		if (mapPartners === null) return [];
		const cached = mapEmphCache.get(lineIndex);
		if (cached) return cached;
		const partner = mapPartners.get(lineIndex);
		const line = listAllLines[lineIndex];
		if (partner === undefined || !line) return [];
		const other = listAllLines[partner];
		const isDel = line.kind === 'del';
		const { listOld, listNew } = intralineRanges(
			isDel ? line.text : other.text,
			isDel ? other.text : line.text
		);
		mapEmphCache.set(lineIndex, isDel ? listOld : listNew);
		mapEmphCache.set(partner, isDel ? listNew : listOld);
		return isDel ? listOld : listNew;
	}

	/** Two halves side by side cannot share one sideways scroll, so split view always wraps. */
	const wrapActive = $derived(wrap || effectiveLayout === 'split');

	const blameBlocks = $derived(blame ? buildBlameBlocks(blame.listLineHashes) : null);

	/**
	 * Lines can be picked only where a picked line maps onto one line of the diff git would apply:
	 * no blame, and whitespace counted — a patch built from a `-w` diff does not apply. Both layouts
	 * pick: a split row is two lines, one per half.
	 */
	const pickable = $derived(staging !== null && blame === null && !ignoreWhitespace);
	let setPicked = $state(new Set<string>());
	let lastPickedRow: number | null = null;
	/** Which half of a split row the last pick was on; null in the unified layout. */
	let lastPickedHalf: 0 | 1 | null = null;
	// A new diff — another file, or the same one after staging — starts with nothing picked.
	$effect(() => {
		void listHunks;
		void staging;
		void effectiveLayout;
		setPicked = new Set();
		lastPickedRow = null;
		lastPickedHalf = null;
	});

	/** The line a row holds — on a split row, the one in `half` (0 old, 1 new). */
	function cellOf(row: DiffRow | undefined, half: 0 | 1 | null): LineCell | null {
		if (row?.kind === 'line') return row.cell;
		if (row?.kind === 'pair') return half === 0 ? row.left : half === 1 ? row.right : null;
		return null;
	}

	/**
	 * Click picks or drops one changed line; Shift+click picks every changed line up to it. On a
	 * split row a range stays on its half — old lines down the left, new lines down the right — and a
	 * Shift+click on the other half picks just that line.
	 */
	function pickRow(rowIndex: number, range: boolean, half: 0 | 1 | null = null): void {
		const cell = cellOf(listRows[rowIndex], half);
		const key = cell ? pickKey(cell.line) : null;
		if (key === null) return;
		const next = new Set(setPicked);
		if (range && lastPickedRow !== null && lastPickedHalf === half) {
			const from = Math.min(lastPickedRow, rowIndex);
			const to = Math.max(lastPickedRow, rowIndex);
			for (let index = from; index <= to; index++) {
				const between = cellOf(listRows[index], half);
				const betweenKey = between ? pickKey(between.line) : null;
				if (betweenKey !== null) next.add(betweenKey);
			}
		} else if (next.has(key)) next.delete(key);
		else next.add(key);
		setPicked = next;
		lastPickedRow = rowIndex;
		lastPickedHalf = half;
	}

	function selectedLine(line: DiffHunk['listLines'][number]): SelectedDiffLine {
		return {
			kind: line.kind === 'add' ? 'add' : 'del',
			oldLine: line.oldLine,
			newLine: line.newLine,
			text: line.text,
		};
	}

	const listPickedLines = $derived(
		listHunks
			.flatMap((hunk) => hunk.listLines)
			.filter((line) => {
				const key = pickKey(line);
				return key !== null && setPicked.has(key);
			})
			.map(selectedLine)
	);

	function stageHunk(hunkIndex: number, action: 'stage' | 'unstage' | 'discard'): void {
		const listLines = (listHunks[hunkIndex]?.listLines ?? [])
			.filter((line) => line.kind !== 'context')
			.map(selectedLine);
		if (listLines.length > 0) onstageLines(action, listLines);
	}

	function stagePicked(action: 'stage' | 'unstage' | 'discard'): void {
		if (listPickedLines.length > 0) onstageLines(action, listPickedLines);
	}
	/** Blame's annotation column takes the place of the old-line gutter. */
	const leadW = $derived(blame ? BLAME_W + GUTTER_W : GUTTER_W * 2);

	const listStats = $derived.by(() => {
		let added = 0;
		let deleted = 0;
		for (const hunk of listHunks) {
			for (const line of hunk.listLines) {
				if (line.kind === 'add') added++;
				else if (line.kind === 'del') deleted++;
			}
		}
		return { added, deleted };
	});

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);

	/** The width of one `0` in the code font, measured: wrapping is counted in these. */
	let measureW = $state(0);
	const charW = $derived(measureW / 100);

	// The same tab size as `tab-size` on the rows, so the width computed here is the width drawn.
	const listRowColumns = $derived(listRows.map((row) => rowColumns(row, tabSize)));
	/**
	 * Characters that fit on one wrapped line, or null when lines do not wrap. Counted rather than
	 * measured per row — the rows are virtualised, so most of them are not in the DOM to measure. A
	 * count that comes out high leaves a blank line; one that comes out low would clip, so the
	 * rounding goes the safe way.
	 */
	const columnsPerLine = $derived.by(() => {
		if (!wrapActive || charW === 0 || viewportW === 0) return null;
		// A split half also loses the 1px border between the halves.
		const textW = effectiveLayout === 'split' ? viewportW / 2 - GUTTER_W - 1 : viewportW - leadW;
		return Math.max(8, Math.floor((textW - WRAP_SLACK_PX) / charW));
	});
	const listLineCounts = $derived(rowLineCounts(listRowColumns, columnsPerLine));
	/** Line each row starts on; the last entry is the total. Positions are these times `ROW_H`. */
	const listTops = $derived(prefixLines(listLineCounts));
	const topOf = (index: number): number => (listTops[index] ?? 0) * ROW_H;
	const heightOf = (index: number): number => (listLineCounts[index] ?? 1) * ROW_H;

	const totalH = $derived((listTops[listTops.length - 1] ?? 0) * ROW_H);
	const start = $derived(
		Math.max(0, rowAtLine(listTops, Math.floor(scrollTop / ROW_H)) - OVERSCAN)
	);
	const end = $derived(
		Math.min(
			listRows.length,
			rowAtLine(listTops, Math.ceil((scrollTop + viewportH) / ROW_H)) + OVERSCAN + 1
		)
	);
	const visible = $derived(listRows.slice(start, end).map((row, k) => ({ row, index: start + k })));

	/**
	 * Where each run of changed lines starts. A block of five deletions followed by five additions
	 * is one change, not ten — stepping through it line by line would be useless in the whole-file
	 * view, which is exactly where stepping matters.
	 */
	const listChangeRows = $derived.by(() => {
		const list: number[] = [];
		let inChange = false;
		listRows.forEach((row, index) => {
			const changed = isChangeRow(row);
			if (changed && !inChange) list.push(index);
			inChange = changed;
		});
		return list;
	});

	/**
	 * The widest line of the whole file, not of the rows on screen: sized from what is rendered, the
	 * horizontal bar would change length every time scrolling down virtualised a longer line in.
	 */
	const maxColumns = $derived(Math.max(0, ...listRowColumns.flat()));
	// `ch` resolves against the code font set on `.spacer-v`; the marker is already counted in
	// `rowColumns`, the px are the slack.
	const contentWidth = $derived(wrapActive ? '100%' : `calc(${leadW}px + ${maxColumns}ch + 16px)`);

	const listMarks = $derived(computeRulerMarks(listRows.map(rulerKind), listLineCounts));

	let rulerH = $state(0);

	/** The slice of the file on screen, drawn on the ruler the way a scrollbar thumb would be. */
	const thumb = $derived.by(() => {
		if (totalH === 0) return { top: 0, height: 100 };
		return {
			top: Math.min(100, (scrollTop / totalH) * 100),
			height: Math.min(100, (viewportH / totalH) * 100),
		};
	});

	/**
	 * The ruler is the scrollbar: the native one is hidden, so this has to drag as well as jump.
	 * `grabOffset` is where inside the thumb the pointer went down, which is what keeps the file
	 * from lurching by half a screen the moment a drag starts.
	 */
	let dragging = $state(false);
	let grabOffset = 0;

	function scrollFromPointer(clientY: number, bounds: DOMRect): void {
		if (!viewport || rulerH === 0 || totalH === 0) return;
		const max = Math.max(0, totalH - viewportH);
		const top = ((clientY - bounds.top - grabOffset) / rulerH) * totalH;
		viewport.scrollTop = Math.min(max, Math.max(0, top));
	}

	function startRulerDrag(event: PointerEvent): void {
		if (!viewport || rulerH === 0 || totalH === 0 || event.button !== 0) return;
		const element = event.currentTarget as HTMLElement;
		const bounds = element.getBoundingClientRect();
		const thumbTop = (scrollTop / totalH) * rulerH;
		const thumbH = (viewportH / totalH) * rulerH;
		const offset = event.clientY - bounds.top - thumbTop;
		// On the thumb: hold the point that was grabbed. Anywhere else: centre the thumb on the
		// cursor first, the way clicking a scrollbar track does, then drag from there.
		grabOffset = offset >= 0 && offset <= thumbH ? offset : thumbH / 2;
		dragging = true;
		element.setPointerCapture(event.pointerId);
		scrollFromPointer(event.clientY, bounds);
	}

	function moveRulerDrag(event: PointerEvent): void {
		if (!dragging) return;
		scrollFromPointer(event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect());
	}

	function endRulerDrag(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	/**
	 * The horizontal bar, built like the ruler for the same reason: the native bars are hidden. It is
	 * only drawn when the code is wider than the view.
	 */
	let scrollLeft = $state(0);
	let viewportW = $state(0);
	let contentW = $state(0);
	let hbarW = $state(0);
	let hDragging = $state(false);
	let hGrabOffset = 0;

	const overflowsX = $derived(!wrapActive && contentW > viewportW + 1);
	const hThumb = $derived.by(() => {
		if (contentW === 0) return { left: 0, width: 100 };
		return {
			left: Math.min(100, (scrollLeft / contentW) * 100),
			width: Math.min(100, (viewportW / contentW) * 100),
		};
	});

	function scrollLeftFromPointer(clientX: number, bounds: DOMRect): void {
		if (!viewport || hbarW === 0 || contentW === 0) return;
		const max = Math.max(0, contentW - viewportW);
		const left = ((clientX - bounds.left - hGrabOffset) / hbarW) * contentW;
		viewport.scrollLeft = Math.min(max, Math.max(0, left));
	}

	function startHbarDrag(event: PointerEvent): void {
		if (!viewport || hbarW === 0 || contentW === 0 || event.button !== 0) return;
		const element = event.currentTarget as HTMLElement;
		const bounds = element.getBoundingClientRect();
		const thumbLeft = (scrollLeft / contentW) * hbarW;
		const thumbW = (viewportW / contentW) * hbarW;
		const offset = event.clientX - bounds.left - thumbLeft;
		hGrabOffset = offset >= 0 && offset <= thumbW ? offset : thumbW / 2;
		hDragging = true;
		element.setPointerCapture(event.pointerId);
		scrollLeftFromPointer(event.clientX, bounds);
	}

	function moveHbarDrag(event: PointerEvent): void {
		if (!hDragging) return;
		scrollLeftFromPointer(
			event.clientX,
			(event.currentTarget as HTMLElement).getBoundingClientRect()
		);
	}

	function endHbarDrag(event: PointerEvent): void {
		if (!hDragging) return;
		hDragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	/** Rows of context kept above a change when it is scrolled to, so it does not sit on the edge. */
	const ANCHOR_ROWS = 3;
	const anchorTop = $derived(scrollTop + ANCHOR_ROWS * ROW_H);
	const prevTarget = $derived(listChangeRows.filter((index) => topOf(index) < anchorTop - 1).pop());
	const nextTarget = $derived(listChangeRows.find((index) => topOf(index) > anchorTop + 1));

	/** Where scrolling to a change actually lands, clamped the same way the viewport clamps it. */
	function changeScrollTop(index: number): number {
		const max = Math.max(0, totalH - viewportH);
		return Math.min(max, Math.max(0, topOf(index) - ANCHOR_ROWS * ROW_H));
	}

	// Enabled only when clicking would move the view: near the edges a further change can still
	// exist while the scroll position is already pinned against the clamp.
	const hasPrevChange = $derived(
		prevTarget !== undefined && changeScrollTop(prevTarget) < scrollTop
	);
	const hasNextChange = $derived(
		nextTarget !== undefined && changeScrollTop(nextTarget) > scrollTop
	);

	/**
	 * The run of changed lines the jump landed on, flashed briefly so the eye finds it. One overlay
	 * element rather than a per-row class: it spans the whole run, and re-keying it by `seq` is what
	 * restarts the fade when the user steps again before the previous flash has finished.
	 */
	let flash = $state<{ start: number; end: number; seq: number } | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Plain counter, deliberately NOT `$state` and never read from `flash`: `flashChange` runs
	 * inside the landing `$effect`, and reading `flash` there made it a dependency of the very
	 * effect that writes it — an infinite update loop that killed the whole view on open.
	 */
	let flashSeq = 0;

	function changeRunEnd(startIndex: number): number {
		let end = startIndex;
		while (end + 1 < listRows.length) {
			if (!isChangeRow(listRows[end + 1])) break;
			end++;
		}
		return end;
	}

	function flashChange(startIndex: number): void {
		clearTimeout(flashTimer);
		flash = { start: startIndex, end: changeRunEnd(startIndex), seq: ++flashSeq };
		// Matches the CSS: held for 250ms, faded over 350ms — gone from the DOM once it has faded.
		flashTimer = setTimeout(() => (flash = null), 600);
	}

	function goToChange(step: 1 | -1): void {
		const target = step === 1 ? nextTarget : prevTarget;
		if (target === undefined || !viewport) return;
		viewport.scrollTo({ top: changeScrollTop(target) });
		flashChange(target);
	}

	/**
	 * A newly drawn diff opens on its first change, not at line 1.
	 *
	 * Keeping the old offset would land mid-file at random, but the top is barely better in the
	 * whole-file view: a change 2000 lines down leaves the reader looking at a screenful of
	 * untouched text with no sign of where to go. Reading `listChangeRows` also makes this run again
	 * when the hunks arrive, which is what makes switching mode land on the change rather than the
	 * empty list that is there while the new diff is still loading.
	 */
	$effect(() => {
		void path;
		void mode;
		void layout;
		// Deliberately not `changeScrollTop`: clamping would read the viewport height, and this would
		// then re-run on every resize, yanking the reader back to the first change.
		const first = listChangeRows[0];
		// Untracked for the same reason: with wrapping on, row positions follow the panel's width.
		const top =
			first === undefined ? 0 : Math.max(0, untrack(() => topOf(first)) - ANCHOR_ROWS * ROW_H);
		// The state is set too: while a diff loads the viewport is unmounted, so a remount would
		// otherwise virtualise from the previous file's offset and draw a blank screenful.
		scrollTop = top;
		scrollLeft = 0;
		viewport?.scrollTo({ top, left: 0 });
		// Landing on the first change is a jump the user did not steer, so it flashes like one.
		if (first !== undefined) flashChange(first);
	});

	const fileName = $derived(path.split('/').pop() ?? path);
	/**
	 * The folder, shortened from the middle: `assets/.../leaderboard-panel/`. The name of the file
	 * is the one part that must survive, and a path deep enough to need eliding is one where the
	 * top and the immediate parent say more than the segments between them.
	 */
	const folder = $derived.by(() => {
		const listParts = path.split('/').slice(0, -1);
		if (listParts.length === 0) return '';
		if (listParts.length <= 2) return `${listParts.join('/')}/`;
		return `${listParts[0]}/…/${listParts[listParts.length - 1]}/`;
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

{#snippet cellText(cell: LineCell)}
	{@const listEmph = cell.line.kind === 'context' ? [] : emphFor(cell.lineIndex)}
	{@const listTokens =
		listEmph.length > 0
			? applyRanges(listLineTokens?.[cell.lineIndex], cell.line.text, listEmph)
			: listLineTokens?.[cell.lineIndex]}
	<!-- Token spans carry nothing but a colour, so the row keeps exactly the height of the plain
	     branch it replaces. -->
	<span class="text"
		><span class="marker"
			>{cell.line.kind === 'add' ? '+' : cell.line.kind === 'del' ? '-' : ' '}</span
		>{#if listTokens}{#each listTokens as token}<span
					style:color={token.color}
					class:emph={token.emph}>{token.content}</span
				>{/each}{:else}{cell.line.text}{/if}</span
	>
{/snippet}

<div class="diff" style="--tab-size:{tabSize}">
	<header>
		<span class="path" use:tooltip={path}>
			<span class="folder">{folder}</span><b class="file">{fileName}</b>
		</span>
		<span class="title">{title}</span>
		{#if listStats.added > 0 || listStats.deleted > 0}
			<span class="stats">
				<span class="add">+{listStats.added}</span>
				<span class="del">−{listStats.deleted}</span>
			</span>
		{/if}

		<span class="spacer"></span>

		{#if pickable && listPickedLines.length > 0}
			{@const count = `${listPickedLines.length} line${listPickedLines.length === 1 ? '' : 's'}`}
			<span class="pick-actions">
				{#if staging === 'unstaged'}
					<button class="primary" onclick={() => stagePicked('stage')}>Stage {count}</button>
					<button onclick={() => stagePicked('discard')}>Discard</button>
				{:else}
					<button class="primary" onclick={() => stagePicked('unstage')}>Unstage {count}</button>
				{/if}
				<button onclick={() => (setPicked = new Set())}>Clear</button>
			</span>
		{/if}

		<IconButton
			name="chevron-up"
			label="Previous change"
			disabled={!hasPrevChange}
			onclick={() => goToChange(-1)}
		/>
		<IconButton
			name="chevron-down"
			label="Next change"
			disabled={!hasNextChange}
			onclick={() => goToChange(1)}
		/>
		{#if image || lfs || submodule}
			<!-- An image, an LFS object or a submodule has no lines: none of the text views apply. -->
		{:else if blame === null}
			<span class="modes">
				<button class:active={mode === 'compact'} onclick={() => onmode('compact')}>Changes</button>
				<button class:active={mode === 'full'} onclick={() => onmode('full')}>Whole file</button>
			</span>
			<IconButton
				name="split-horizontal"
				label="Side by side"
				title="Show the old and new file side by side"
				pressed={layout === 'split'}
				onclick={() => onlayout(layout === 'split' ? 'unified' : 'split')}
			/>
			<IconButton
				name="word-wrap"
				label="Wrap long lines"
				title={layout === 'split' ? 'Side by side always wraps long lines' : 'Wrap long lines'}
				pressed={wrapActive}
				disabled={layout === 'split'}
				onclick={onwrap}
			/>
			<IconButton
				name="whitespace"
				label="Ignore whitespace"
				title="Ignore changes that are only whitespace"
				pressed={ignoreWhitespace}
				onclick={onwhitespace}
			/>
		{:else}
			<IconButton name="word-wrap" label="Wrap long lines" pressed={wrapActive} onclick={onwrap} />
		{/if}
		<IconButton
			name="account"
			label="Blame"
			title="Show who last changed each line"
			pressed={blame !== null}
			disabled={!canTrace}
			onclick={onblame}
		/>
		<IconButton
			name="history"
			label="File history"
			title="Show the commits that changed this file"
			disabled={!canTrace}
			onclick={onhistory}
		/>
		<IconButton
			name="close"
			label="Close the diff"
			title="Close the diff and go back to the graph (Esc)"
			onclick={onclose}
		/>
	</header>

	{#if submodule}
		<div class="media">
			<SubmoduleCard {path} {submodule} onopen={onopenSubmodule} />
		</div>
	{:else if image || lfs}
		<div class="media">
			{#if lfs}<LfsCard {lfs} />{/if}
			{#if image}<ImageCompare {image} />{/if}
		</div>
	{:else if notice}
		<p class="hint">{notice}</p>
	{:else}
		<!--
			Stays mounted while the next file loads. Tearing it down and building it again for every
			file rebuilt the viewport, the ruler and the scroll state, which is a lot of work to show
			one line of text — the rows go empty instead and the hint sits over the top.
		-->
		<div class="body" class:gg-enter-fade={!loading}>
			<div class="pane">
				<div
					class="viewport"
					id="diff-viewport"
					bind:this={viewport}
					bind:clientHeight={viewportH}
					bind:clientWidth={viewportW}
					onscroll={(event) => {
						scrollTop = event.currentTarget.scrollTop;
						scrollLeft = event.currentTarget.scrollLeft;
					}}
				>
					<div
						class="spacer-v"
						style="height:{totalH}px; width:{contentWidth}"
						bind:offsetWidth={contentW}
					>
						<span class="measure" aria-hidden="true" bind:offsetWidth={measureW}
							>{'0'.repeat(100)}</span
						>
						{#each visible as v (v.index)}
							{#if v.row.kind === 'gap'}
								<div class="row gap" style="top:{topOf(v.index)}px; height:{heightOf(v.index)}px">
									<span class="gutter"></span>
									<span class="gutter"></span>
									<span class="text">{v.row.label}{v.row.heading ? ` ${v.row.heading}` : ''}</span>
									{#if pickable}
										{@const hunkIndex = v.row.hunkIndex}
										<span class="hunk-actions">
											{#if staging === 'unstaged'}
												<button onclick={() => stageHunk(hunkIndex, 'stage')}>Stage hunk</button>
												<button onclick={() => stageHunk(hunkIndex, 'discard')}>Discard hunk</button
												>
											{:else}
												<button onclick={() => stageHunk(hunkIndex, 'unstage')}>Unstage hunk</button
												>
											{/if}
										</span>
									{/if}
								</div>
							{:else if v.row.kind === 'line'}
								<div
									class="row {v.row.cell.line.kind}"
									class:wrap={wrapActive}
									class:blame-alt={blameBlocks?.listParity[v.row.cell.lineIndex] === 1}
									class:pickable={pickable && v.row.cell.line.kind !== 'context'}
									class:picked={pickable && setPicked.has(pickKey(v.row.cell.line) ?? '')}
									style="top:{topOf(v.index)}px; height:{heightOf(v.index)}px"
								>
									{#if pickable && v.row.cell.line.kind !== 'context'}
										{@const rowIndex = v.index}
										{@const picked = setPicked.has(pickKey(v.row.cell.line) ?? '')}
										<!-- The line numbers are the handle: the code beside them stays selectable as text. -->
										<button
											class="gutter"
											aria-pressed={picked}
											aria-label="Pick line"
											use:tooltip={'Pick this line — Shift+click picks a range'}
											onclick={(event) => pickRow(rowIndex, event.shiftKey)}
											>{v.row.cell.line.oldLine ?? ''}</button
										>
										<button
											class="gutter"
											aria-pressed={picked}
											aria-label="Pick line"
											onclick={(event) => pickRow(rowIndex, event.shiftKey)}
											>{v.row.cell.line.newLine ?? ''}</button
										>
									{:else if blame && blameBlocks}
										{@const hash = blame.listLineHashes[v.row.cell.lineIndex]}
										{#if blameBlocks.listStarts[v.row.cell.lineIndex]}
											{@const label = blameLabel(hash, blame.mapCommits[hash])}
											<button
												class="blame"
												use:tooltip={label.detail}
												onclick={() => onrevealCommit(hash)}>{label.text}</button
											>
										{:else}
											<span class="blame"></span>
										{/if}
										<span class="gutter">{v.row.cell.line.newLine ?? ''}</span>
									{:else}
										<span class="gutter">{v.row.cell.line.oldLine ?? ''}</span>
										<span class="gutter">{v.row.cell.line.newLine ?? ''}</span>
									{/if}
									{@render cellText(v.row.cell)}
								</div>
							{:else}
								<div
									class="row pair wrap"
									style="top:{topOf(v.index)}px; height:{heightOf(v.index)}px"
								>
									{#each [v.row.left, v.row.right] as cell, side (side)}
										{@const lineNumber =
											cell === null
												? ''
												: side === 0
													? (cell.line.oldLine ?? '')
													: (cell.line.newLine ?? '')}
										{@const canPick = pickable && cell !== null && cell.line.kind !== 'context'}
										{@const picked = canPick && setPicked.has(pickKey(cell.line) ?? '')}
										<div
											class="half {cell === null ? 'empty' : cell.line.kind}"
											class:pickable={canPick}
											class:picked
										>
											{#if canPick}
												{@const rowIndex = v.index}
												<button
													class="gutter"
													aria-pressed={picked}
													aria-label="Pick line"
													use:tooltip={'Pick this line — Shift+click picks a range on this side'}
													onclick={(event) => pickRow(rowIndex, event.shiftKey, side === 0 ? 0 : 1)}
													>{lineNumber}</button
												>
											{:else}
												<span class="gutter">{lineNumber}</span>
											{/if}
											{#if cell !== null}{@render cellText(cell)}{/if}
										</div>
									{/each}
								</div>
							{/if}
						{/each}
						{#if flash}
							{#key flash.seq}
								<div
									class="flash"
									style="top:{topOf(flash.start)}px; height:{topOf(flash.end + 1) -
										topOf(flash.start)}px"
								></div>
							{/key}
						{/if}
					</div>
				</div>

				{#if overflowsX}
					<div
						class="hbar"
						class:dragging={hDragging}
						bind:clientWidth={hbarW}
						onpointerdown={startHbarDrag}
						onpointermove={moveHbarDrag}
						onpointerup={endHbarDrag}
						onpointercancel={endHbarDrag}
						role="scrollbar"
						aria-controls="diff-viewport"
						aria-orientation="horizontal"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(hThumb.left)}
						aria-label="Scroll the diff sideways"
						tabindex="-1"
					>
						<span class="hthumb" style="left:{hThumb.left}%; width:{hThumb.width}%"></span>
					</div>
				{/if}
			</div>

			<!-- The whole file at a glance and the scrollbar in one strip: every change is a mark at
			     its own position, so a diff far down a long file is visible without hunting for it,
			     and the thumb over them is what you drag. -->
			<div
				class="ruler"
				class:dragging
				bind:clientHeight={rulerH}
				onpointerdown={startRulerDrag}
				onpointermove={moveRulerDrag}
				onpointerup={endRulerDrag}
				onpointercancel={endRulerDrag}
				role="scrollbar"
				aria-controls="diff-viewport"
				aria-orientation="vertical"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(thumb.top)}
				aria-label="Diff overview — drag to scroll"
				tabindex="-1"
				title="Overview — click or drag to scroll"
			>
				<!-- Two stacked marks of one run share a start, so the kind is part of the key. -->
				{#each listMarks as mark (`${mark.start}:${mark.kind}`)}
					<span class="mark {mark.kind}" style="top:{mark.top}%; height:{mark.height}%"></span>
				{/each}
				<!-- What is on screen right now, so the marks read as positions rather than a legend. -->
				<span class="thumb" style="top:{thumb.top}%; height:{thumb.height}%"></span>
			</div>

			{#if loading}
				<p class="hint loading">Loading diff…</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.media {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: auto;
	}
	.diff {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		flex: none;
		height: var(--gg-header-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		border-bottom: 1px solid var(--gg-seam);
		background: var(--gg-bg-raised);
	}
	/* The folder gives up its width first; the file name is never the part that gets cut. */
	.path {
		display: flex;
		align-items: baseline;
		min-width: 0;
		white-space: nowrap;
	}
	.folder {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--gg-fg-muted);
	}
	.file {
		flex: none;
	}
	.title {
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
		white-space: nowrap;
	}
	.stats {
		display: flex;
		gap: var(--gg-space-1);
		font-size: var(--gg-text-xs);
		white-space: nowrap;
	}
	.stats .add {
		color: var(--gg-added);
	}
	.stats .del {
		color: var(--gg-deleted);
	}
	.spacer {
		flex: 1;
	}
	/* One control, two states — a pair of buttons reads as a switch where a select would not. */
	.modes {
		display: flex;
		flex: none;
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		overflow: hidden;
	}
	/* Same height as the icon buttons beside it, so the row sits on one line. */
	.modes button {
		display: inline-flex;
		align-items: center;
		height: var(--gg-hit);
		background: transparent;
		color: var(--gg-fg);
		border: none;
		cursor: pointer;
		font: inherit;
		font-size: var(--gg-text-xs);
		padding: 0 var(--gg-space-2);
	}
	.modes button:hover:not(.active) {
		background: var(--gg-bg-tool-hover);
	}
	.modes button.active {
		background: var(--gg-bg-selected);
		color: var(--gg-fg-selected);
	}
	.hint {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
	.body {
		position: relative;
		flex: 1;
		display: flex;
		min-height: 0;
	}
	/* Over the empty rows rather than instead of them, so the frame around it never goes away. */
	.hint.loading {
		position: absolute;
		inset: 0 0 auto 0;
		margin: 0;
	}
	/*
	 * No scrollbar of its own: the ruler beside it is the scrollbar, and two bars for one axis is
	 * one too many. `scrollbar-width` is a property on the element, so nothing a host stylesheet
	 * says about `::-webkit-scrollbar` can put the bar back — which the pseudo-element route could
	 * not promise, and a macOS overlay scrollbar still showed through it inside the VS Code webview.
	 * The horizontal axis gets its own drawn bar (`.hbar`) for the same reason.
	 */
	.viewport {
		flex: 1;
		overflow: auto;
		min-height: 0;
		min-width: 0;
		scrollbar-width: none;
		/* The graph is still mounted under this panel; reaching the last line must not scroll it. */
		overscroll-behavior: contain;
	}
	.viewport::-webkit-scrollbar {
		display: none;
	}
	/* The code and the horizontal bar under it, beside the ruler that spans the full height. */
	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.hbar {
		position: relative;
		flex: none;
		height: 10px;
		cursor: pointer;
		border-top: 1px solid var(--gg-border);
		background: var(--gg-bg);
		touch-action: none;
		user-select: none;
	}
	.hthumb {
		position: absolute;
		top: 2px;
		bottom: 2px;
		min-width: 24px;
		border-radius: var(--gg-radius-xs);
		background: color-mix(in srgb, var(--gg-fg) 30%, transparent);
		pointer-events: none;
		transition: background-color 60ms var(--gg-ease);
	}
	.hbar:hover .hthumb {
		background: color-mix(in srgb, var(--gg-fg) 42%, transparent);
	}
	.hbar.dragging .hthumb {
		background: color-mix(in srgb, var(--gg-fg) 55%, transparent);
	}
	/* Sits beside the scroll area rather than over it, so the two never fight for the same pixels. */
	.ruler {
		position: relative;
		flex: none;
		width: 20px;
		cursor: pointer;
		border-left: 1px solid var(--gg-border);
		background: var(--gg-bg);
		/* A drag that leaves the strip must keep scrolling, not select the diff text behind it. */
		touch-action: none;
		user-select: none;
	}
	/* Inset from both edges so the marks read as a lane inside the strip, under the full-width
	   thumb. Stacked del/add marks of one run touch: no radius, or the seam shows a gap. */
	.mark {
		position: absolute;
		left: 3px;
		right: 3px;
	}
	.mark.add {
		background: var(--gg-ruler-added);
	}
	.mark.del {
		background: var(--gg-ruler-deleted);
	}
	/* A run too short to stack: half red, half green — never a third colour. */
	.mark.both {
		background: linear-gradient(90deg, var(--gg-ruler-deleted) 50%, var(--gg-ruler-added) 50%);
	}
	/* Now the only thing showing the scroll position, so it is drawn stronger than an overlay hint. */
	.thumb {
		position: absolute;
		left: 0;
		right: 0;
		min-height: 12px;
		border-radius: var(--gg-radius-xs);
		background: color-mix(in srgb, var(--gg-fg) 30%, transparent);
		pointer-events: none;
		transition: background-color 60ms var(--gg-ease);
	}
	.ruler:hover .thumb {
		background: color-mix(in srgb, var(--gg-fg) 42%, transparent);
	}
	.ruler.dragging .thumb {
		background: color-mix(in srgb, var(--gg-fg) 55%, transparent);
	}
	/* The code font lives here rather than on the rows: the width set inline is counted in `ch`. */
	.spacer-v {
		position: relative;
		min-width: 100%;
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-mono);
	}
	/* Rows span the spacer, so a row's tint runs the full width however far it is scrolled. */
	.row {
		--row-tint: transparent;
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		white-space: pre;
		tab-size: var(--tab-size);
		background: var(--row-tint);
	}
	/*
	 * Line numbers sit in their own fixed columns so the code starts on one vertical line, and stay
	 * put while the code scrolls sideways under them — opaque, with the row's own tint on top.
	 */
	.gutter {
		position: sticky;
		left: 0;
		z-index: 1;
		flex: none;
		width: 44px;
		padding-right: var(--gg-space-2);
		box-sizing: border-box;
		text-align: right;
		color: var(--gg-fg-subtle);
		background: linear-gradient(var(--row-tint), var(--row-tint)), var(--gg-bg);
		user-select: none;
	}
	.blame + .gutter {
		left: 240px;
	}
	.gutter + .gutter {
		left: 44px;
	}
	.text {
		flex: 1 0 auto;
	}
	/*
	 * Blame's annotation column, in place of the old-line gutter: written on the first line of each
	 * run of lines from one commit; runs alternate a faint shade so neighbours read apart.
	 */
	.blame {
		position: sticky;
		left: 0;
		z-index: 1;
		flex: none;
		width: 240px;
		padding: 0 var(--gg-space-2);
		box-sizing: border-box;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		font: inherit;
		line-height: 18px;
		color: var(--gg-fg-muted);
		background: linear-gradient(var(--row-tint), var(--row-tint)), var(--gg-bg);
		border: none;
		border-right: 1px solid var(--gg-border);
	}
	button.blame {
		cursor: pointer;
	}
	button.blame:hover {
		color: var(--gg-fg);
		text-decoration: underline;
	}
	.row.blame-alt {
		--row-tint: color-mix(in srgb, var(--gg-fg) 5%, transparent);
	}
	/* Picking lines: the line numbers are the handle, the picked line gets the focus colour's edge. */
	button.gutter {
		border: none;
		font: inherit;
		cursor: pointer;
	}
	.row.pickable .gutter:hover,
	.half.pickable .gutter:hover {
		color: var(--gg-fg);
	}
	.row.picked,
	.half.picked {
		box-shadow: inset 3px 0 0 var(--gg-focus);
	}
	.row.picked .gutter,
	.half.picked .gutter {
		color: var(--gg-fg);
		font-weight: 600;
	}
	.hunk-actions,
	.pick-actions {
		display: inline-flex;
		gap: var(--gg-space-1);
		flex: none;
	}
	.hunk-actions {
		position: sticky;
		right: var(--gg-space-2);
		margin-left: var(--gg-space-3);
	}
	.hunk-actions button,
	.pick-actions button {
		padding: 0 var(--gg-space-2);
		font: inherit;
		font-family: var(--gg-font);
		font-size: var(--gg-text-sm);
		line-height: 16px;
		color: var(--gg-btn2-fg);
		background: var(--gg-btn2-bg);
		border: none;
		border-radius: var(--gg-radius-sm);
		cursor: pointer;
	}
	.pick-actions button.primary {
		color: var(--gg-btn-fg);
		background: var(--gg-btn-bg);
	}
	/* Laid out in the code font but never seen: one hundred zeros, so a `ch` can be read in px. */
	.measure {
		position: absolute;
		visibility: hidden;
		white-space: pre;
		pointer-events: none;
	}
	/*
	 * A wrapped row is as tall as its line count says; the text breaks anywhere so the count — taken
	 * in characters — is what the browser does, and anything past it is clipped, never drawn over the
	 * row below.
	 */
	.row.wrap {
		align-items: flex-start;
		overflow: hidden;
	}
	.row.wrap .gutter,
	.row.wrap .text {
		line-height: 18px;
	}
	.row.wrap .text {
		flex: 1 1 0;
		min-width: 0;
		white-space: pre-wrap;
		word-break: break-all;
		overflow-wrap: anywhere;
	}
	/* Split view: each half carries its own tint, so a deletion and its replacement read apart. */
	.row.pair {
		background: none;
	}
	.half {
		--row-tint: transparent;
		display: flex;
		align-items: flex-start;
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		background: var(--row-tint);
	}
	.half + .half {
		border-left: 1px solid var(--gg-border);
	}
	.half .gutter {
		position: static;
	}
	.half.add {
		--row-tint: var(--gg-diff-ins-bg);
	}
	.half.del {
		--row-tint: var(--gg-diff-del-bg);
	}
	.half.empty {
		--row-tint: var(--gg-diff-fill);
	}
	.marker {
		display: inline-block;
		width: 1ch;
		color: var(--gg-fg-muted);
	}
	.row.add {
		--row-tint: var(--gg-diff-ins-bg);
	}
	.row.del {
		--row-tint: var(--gg-diff-del-bg);
	}
	/* The words that changed: the row's own tint laid twice more over itself, so it reads stronger in any
	   theme without a colour of its own. */
	.emph {
		background: linear-gradient(var(--row-tint), var(--row-tint)), var(--row-tint);
		border-radius: var(--gg-radius-xs);
	}
	.row.gap {
		--row-tint: var(--gg-diff-fill);
		color: var(--gg-fg-muted);
	}
	/* The jump landing: VS Code's own reveal tint over the run, plus a bar so the block reads even
	   where the add/del row colours drown the tint. Held, then faded — never blinked away. */
	.flash {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--gg-bg-range);
		border-left: 3px solid var(--gg-focus);
		box-sizing: border-box;
		pointer-events: none;
		/* Above the sticky line numbers, or they would cover its bar. */
		z-index: 2;
		animation: gg-flash-fade 600ms var(--gg-ease) forwards;
	}
	@keyframes gg-flash-fade {
		0%,
		41% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
