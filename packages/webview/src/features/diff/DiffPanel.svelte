<script lang="ts">
	import type { DiffHunk } from '@git-octopus/shared';
	import { computeRulerMarks } from '../../lib/diffRuler';
	import type { HighlightToken } from '../../lib/highlight';
	import IconButton from '../../lib/ui/IconButton.svelte';
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
		onmode,
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
		onmode: (mode: DiffMode) => void;
		onclose: () => void;
	} = $props();

	const ROW_H = 18;
	const OVERSCAN = 20;

	/**
	 * Hunks flattened into one list of rows, each hunk preceded by its own separator row. Drawing
	 * from a flat list is what lets the panel virtualise: a file shown whole is tens of thousands
	 * of rows, and only the screenful in view is ever in the DOM.
	 */
	type Row =
		| { kind: 'gap'; heading: string; label: string }
		| { kind: 'line'; line: DiffHunk['listLines'][number]; lineIndex: number };

	const listRows = $derived.by(() => {
		const list: Row[] = [];
		// Counts only real lines, matching how the tokenizer flattens the hunks.
		let lineIndex = 0;
		for (const hunk of listHunks) {
			// The whole-file view is already continuous, so a separator there would be noise.
			if (mode === 'compact') {
				list.push({
					kind: 'gap',
					heading: hunk.heading,
					label: `@@ -${hunk.oldStart} +${hunk.newStart} @@`,
				});
			}
			for (const line of hunk.listLines) list.push({ kind: 'line', line, lineIndex: lineIndex++ });
		}
		return list;
	});

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

	const totalH = $derived(listRows.length * ROW_H);
	const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
	const end = $derived(
		Math.min(listRows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
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
			const changed = row.kind === 'line' && row.line.kind !== 'context';
			if (changed && !inChange) list.push(index);
			inChange = changed;
		});
		return list;
	});

	const listMarks = $derived(
		computeRulerMarks(listRows.map((row) => (row.kind === 'line' ? row.line.kind : 'gap')))
	);

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

	/** Rows of context kept above a change when it is scrolled to, so it does not sit on the edge. */
	const ANCHOR_ROWS = 3;
	const anchorTop = $derived(scrollTop + ANCHOR_ROWS * ROW_H);
	const prevTarget = $derived(
		listChangeRows.filter((index) => index * ROW_H < anchorTop - 1).pop()
	);
	const nextTarget = $derived(listChangeRows.find((index) => index * ROW_H > anchorTop + 1));

	/** Where scrolling to a change actually lands, clamped the same way the viewport clamps it. */
	function changeScrollTop(index: number): number {
		const max = Math.max(0, totalH - viewportH);
		return Math.min(max, Math.max(0, index * ROW_H - ANCHOR_ROWS * ROW_H));
	}

	// Enabled only when clicking would move the view: near the edges a further change can still
	// exist while the scroll position is already pinned against the clamp.
	const hasPrevChange = $derived(
		prevTarget !== undefined && changeScrollTop(prevTarget) < scrollTop
	);
	const hasNextChange = $derived(
		nextTarget !== undefined && changeScrollTop(nextTarget) > scrollTop
	);

	function goToChange(step: 1 | -1): void {
		const target = step === 1 ? nextTarget : prevTarget;
		if (target === undefined || !viewport) return;
		viewport.scrollTo({ top: changeScrollTop(target) });
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
		// Deliberately not `changeScrollTop`: clamping would read the viewport height, and this would
		// then re-run on every resize, yanking the reader back to the first change.
		const first = listChangeRows[0];
		const top = first === undefined ? 0 : Math.max(0, first * ROW_H - ANCHOR_ROWS * ROW_H);
		// The state is set too: while a diff loads the viewport is unmounted, so a remount would
		// otherwise virtualise from the previous file's offset and draw a blank screenful.
		scrollTop = top;
		viewport?.scrollTo({ top });
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

<div class="diff">
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
		<span class="modes">
			<button class:active={mode === 'compact'} onclick={() => onmode('compact')}>Changes</button>
			<button class:active={mode === 'full'} onclick={() => onmode('full')}>Whole file</button>
		</span>
		<IconButton
			name="close"
			label="Close the diff"
			title="Close the diff and go back to the graph (Esc)"
			onclick={onclose}
		/>
	</header>

	{#if notice}
		<p class="hint">{notice}</p>
	{:else}
		<!--
			Stays mounted while the next file loads. Tearing it down and building it again for every
			file rebuilt the viewport, the ruler and the scroll state, which is a lot of work to show
			one line of text — the rows go empty instead and the hint sits over the top.
		-->
		<div class="body" class:gg-enter-fade={!loading}>
			<div
				class="viewport"
				id="diff-viewport"
				bind:this={viewport}
				bind:clientHeight={viewportH}
				onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
			>
				<div class="spacer-v" style="height:{totalH}px">
					{#each visible as v (v.index)}
						{#if v.row.kind === 'gap'}
							<div class="row gap" style="top:{v.index * ROW_H}px; height:{ROW_H}px">
								<span class="gutter"></span>
								<span class="gutter"></span>
								<span class="text">{v.row.label}{v.row.heading ? ` ${v.row.heading}` : ''}</span>
							</div>
						{:else}
							{@const listTokens = listLineTokens?.[v.row.lineIndex]}
							<div class="row {v.row.line.kind}" style="top:{v.index * ROW_H}px; height:{ROW_H}px">
								<span class="gutter">{v.row.line.oldLine ?? ''}</span>
								<span class="gutter">{v.row.line.newLine ?? ''}</span>
								<!-- Token spans carry nothing but a colour, so the row keeps exactly the height
								     and ellipsis behaviour of the plain branch it replaces. -->
								<span class="text"
									><span class="marker"
										>{v.row.line.kind === 'add' ? '+' : v.row.line.kind === 'del' ? '-' : ' '}</span
									>{#if listTokens}{#each listTokens as token}<span style:color={token.color}
												>{token.content}</span
											>{/each}{:else}{v.row.line.text}{/if}</span
								>
							</div>
						{/if}
					{/each}
				</div>
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
		border-bottom: 1px solid var(--gg-border);
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
		font-size: 0.85em;
		white-space: nowrap;
	}
	.stats {
		display: flex;
		gap: var(--gg-space-1);
		font-size: 0.85em;
		white-space: nowrap;
	}
	.stats .add {
		color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
	}
	.stats .del {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
	}
	.spacer {
		flex: 1;
	}
	/* One control, two states — a pair of buttons reads as a switch where a select would not. */
	.modes {
		display: flex;
		flex: none;
		border: 1px solid var(--gg-border);
		border-radius: 4px;
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
		font-size: 0.85em;
		padding: 0 var(--gg-space-2);
	}
	.modes button:hover:not(.active) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.modes button.active {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
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
	 * Nothing is lost on the other axis: long lines ellipsize, so this never scrolls sideways.
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
		background: var(--vscode-editorOverviewRuler-addedForeground, #3fb950);
	}
	.mark.del {
		background: var(--vscode-editorOverviewRuler-deletedForeground, #f85149);
	}
	/* A run too short to stack: half red, half green — never a third colour. */
	.mark.both {
		background: linear-gradient(
			90deg,
			var(--vscode-editorOverviewRuler-deletedForeground, #f85149) 50%,
			var(--vscode-editorOverviewRuler-addedForeground, #3fb950) 50%
		);
	}
	/* Now the only thing showing the scroll position, so it is drawn stronger than an overlay hint. */
	.thumb {
		position: absolute;
		left: 0;
		right: 0;
		min-height: 12px;
		border-radius: 2px;
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
	.spacer-v {
		position: relative;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--vscode-editor-font-size, 12px);
		white-space: pre;
	}
	/* Line numbers sit in their own fixed columns so the code starts on one vertical line. */
	.gutter {
		flex: none;
		width: 44px;
		padding-right: var(--gg-space-2);
		box-sizing: border-box;
		text-align: right;
		color: var(--vscode-editorLineNumber-foreground, var(--gg-fg-muted));
		user-select: none;
	}
	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.marker {
		display: inline-block;
		width: 1ch;
		color: var(--gg-fg-muted);
	}
	.row.add {
		background: var(--vscode-diffEditor-insertedTextBackground, rgba(63, 185, 80, 0.15));
	}
	.row.del {
		background: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.15));
	}
	.row.gap {
		background: var(--vscode-diffEditor-diagonalFill, rgba(128, 128, 128, 0.12));
		color: var(--gg-fg-muted);
	}
</style>
