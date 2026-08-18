<script lang="ts">
	import type { ColumnVisibility, ColumnWidths, RowDensity } from '../../lib/viewSettings';

	let {
		columns,
		widths,
		rowDensity,
	}: {
		columns: ColumnVisibility;
		widths: ColumnWidths;
		rowDensity: RowDensity;
	} = $props();

	/** Kept in step with `GraphView`: the skeleton is only useful if the real graph lands on it. */
	const mapRowHeight: Record<RowDensity, number> = {
		compact: 26,
		comfortable: 34,
		spacious: 44,
	};
	const ROW_H = $derived(mapRowHeight[rowDensity]);
	const COL_W = 20;
	const PAD = 12;
	const NODE_R = 4;
	const LANES = 3;
	const graphPx = LANES * COL_W + PAD;

	/*
	 * Fixed patterns, not random widths: a skeleton that reshuffles every re-render reads as a
	 * broken list rather than as content on its way.
	 */
	const listLane = [0, 0, 1, 0, 2, 1, 0, 1, 0, 0, 2, 1, 0, 1, 0, 1];
	const listRefW = [64, 0, 0, 48, 0, 76, 0, 0, 52, 0, 0, 68, 0, 0, 44, 0];
	const listSubjectW = [62, 48, 74, 55, 40, 68, 50, 72, 44, 58, 66, 52, 78, 46, 60, 54];

	let viewportH = $state(0);
	const rowCount = $derived(Math.max(1, Math.ceil(viewportH / ROW_H) + 1));
	const listRows = $derived(Array.from({ length: rowCount }, (_, i) => i));

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

	const laneX = (column: number) => PAD + column * COL_W;
	const at = <T,>(list: T[], i: number): T => list[i % list.length];
</script>

<div class="skeleton" aria-busy="true" aria-label="Loading commits">
	<div class="headers" style="grid-template-columns:{gridTemplate}">
		<span class="hcell">Branch / Tag</span>
		<span class="hcell">Graph</span>
		<span class="hcell">Description</span>
		{#if columns.author}<span class="hcell">Author</span>{/if}
		{#if columns.commit}<span class="hcell">Commit</span>{/if}
		{#if columns.date}<span class="hcell">Date</span>{/if}
	</div>

	<div class="body" bind:clientHeight={viewportH}>
		<svg
			class="lines"
			width={graphPx}
			height={rowCount * ROW_H}
			style="left:{widths.ref}px"
			aria-hidden="true"
		>
			{#each { length: LANES } as _, lane (lane)}
				<line
					x1={laneX(lane)}
					y1="0"
					x2={laneX(lane)}
					y2={rowCount * ROW_H}
					stroke="currentColor"
					stroke-width="1.5"
				/>
			{/each}
			{#each listRows as i (i)}
				<circle
					cx={laneX(at(listLane, i))}
					cy={i * ROW_H + ROW_H / 2}
					r={NODE_R}
					fill="currentColor"
				/>
			{/each}
		</svg>

		{#each listRows as i (i)}
			<div class="row" style="height:{ROW_H}px; grid-template-columns:{gridTemplate}">
				<span class="cell refs">
					{#if at(listRefW, i) > 0}<span
							class="gg-skeleton-bar bar chip"
							style="width:{at(listRefW, i)}px"
						></span>{/if}
				</span>
				<span class="cell"></span>
				<span class="cell"
					><span class="gg-skeleton-bar bar" style="width:{at(listSubjectW, i)}%"></span></span
				>
				{#if columns.author}<span class="cell"
						><span class="gg-skeleton-bar bar" style="width:60%"></span></span
					>{/if}
				{#if columns.commit}<span class="cell"
						><span class="gg-skeleton-bar bar" style="width:70%"></span></span
					>{/if}
				{#if columns.date}<span class="cell date"
						><span class="gg-skeleton-bar bar" style="width:80%"></span></span
					>{/if}
			</div>
		{/each}

		<div class="gg-shimmer"></div>
	</div>
</div>

<style>
	.skeleton {
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
	.hcell {
		display: flex;
		align-items: center;
		justify-content: center;
		white-space: nowrap;
		overflow: hidden;
		min-width: 0;
	}
	.body {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		/* Faded tail: unlike real rows, the placeholder has no end, so it should not look like one. */
		mask-image: linear-gradient(to bottom, #000 55%, transparent 100%);
	}
	.lines {
		position: absolute;
		top: 0;
		color: var(--gg-fg-muted);
		opacity: 0.25;
		pointer-events: none;
	}
	.row {
		display: grid;
		align-items: center;
		gap: var(--gg-space-2);
	}
	.cell {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
	}
	/* Same alignment as the real cells, so nothing slides sideways when the commits arrive. */
	.refs {
		justify-content: flex-end;
		padding-left: var(--gg-space-2);
	}
	.date {
		justify-content: flex-end;
	}
	.bar {
		height: 9px;
	}
	.chip {
		height: 14px;
		border-radius: var(--gg-chip-radius);
	}
</style>
