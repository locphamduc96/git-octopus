<script lang="ts">
	import type { GraphRow } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';

	let { rows }: { rows: GraphRow[] } = $props();

	const ROW_H = 24;
	const COL_W = 14;
	const PAD = 10;
	const NODE_R = 4;

	const cols = $derived(graphWidth(rows));
	const graphPx = $derived(cols * COL_W + PAD);
	const heightPx = $derived(rows.length * ROW_H);

	const cx = (col: number): number => PAD + col * COL_W;
	const cy = (rowIndex: number): number => rowIndex * ROW_H + ROW_H / 2;

	function fmtDate(epochSeconds: number): string {
		return new Date(epochSeconds * 1000).toLocaleDateString();
	}
</script>

<div class="graph">
	<svg class="lines" width={graphPx} height={heightPx} aria-hidden="true">
		{#each rows as row, i (row.commit.hash)}
			{#each row.edges as edge, e (e)}
				<line
					x1={cx(edge.fromColumn)}
					y1={cy(i)}
					x2={cx(edge.toColumn)}
					y2={cy(i + 1)}
					stroke={graphColour(edge.colour)}
					stroke-width="2"
				/>
			{/each}
		{/each}
		{#each rows as row, i (row.commit.hash)}
			<circle cx={cx(row.nodeColumn)} cy={cy(i)} r={NODE_R} fill={graphColour(row.nodeColour)} />
		{/each}
	</svg>
	<ul class="rows" style="margin-left:{graphPx}px">
		{#each rows as row (row.commit.hash)}
			<li class="row" style="height:{ROW_H}px" title={row.commit.hash}>
				<span class="subject">{row.commit.subject}</span>
				<span class="meta">{row.commit.author.name} · {fmtDate(row.commit.committedAt)}</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.graph {
		position: relative;
	}
	.lines {
		position: absolute;
		top: 0;
		left: 0;
		overflow: visible;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gg-space-3);
		padding: 0 var(--gg-space-2);
		overflow: hidden;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.subject {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
</style>
