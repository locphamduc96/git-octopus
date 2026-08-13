<script lang="ts">
	import type { Commit, CommitActionId, GraphRow, Ref } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';

	let {
		rows,
		selectedHash,
		onselect,
		onaction,
	}: {
		rows: GraphRow[];
		selectedHash: string | null;
		onselect: (hash: string) => void;
		onaction: (action: CommitActionId, commit: Commit) => void;
	} = $props();

	let menu = $state<{ x: number; y: number; commit: Commit } | null>(null);

	function openMenu(event: MouseEvent, commit: Commit): void {
		event.preventDefault();
		onselect(commit.hash);
		menu = { x: event.clientX, y: event.clientY, commit };
	}

	const menuItems = $derived.by(() => {
		if (!menu) return [];
		const hasLocalBranch = menu.commit.refs.some((r) => r.kind === 'branch' && !r.remote);
		const items: { id: string; label: string; separatorBefore?: boolean }[] = [
			{ id: 'checkout', label: 'Checkout Commit' },
			{ id: 'createBranch', label: 'Create Branch…' },
			{ id: 'merge', label: 'Merge into current branch…' },
		];
		if (hasLocalBranch) items.push({ id: 'deleteBranch', label: 'Delete Branch…' });
		items.push({ id: 'copyHash', label: 'Copy Commit Hash', separatorBefore: true });
		items.push({ id: 'copySubject', label: 'Copy Subject' });
		return items;
	});

	function onMenuSelect(id: string): void {
		const commit = menu?.commit;
		menu = null;
		if (commit) onaction(id as CommitActionId, commit);
	}

	const ROW_H = 24;
	const COL_W = 14;
	const PAD = 10;
	const NODE_R = 4;
	const OVERSCAN = 8;

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);

	const cols = $derived(graphWidth(rows));
	const graphPx = $derived(cols * COL_W + PAD);
	const totalH = $derived(rows.length * ROW_H);
	const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
	const end = $derived(Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN));
	const visible = $derived(rows.slice(start, end).map((row, k) => ({ row, index: start + k })));

	const cx = (col: number): number => PAD + col * COL_W;
	const cy = (rowIndex: number): number => rowIndex * ROW_H + ROW_H / 2;

	function edgePath(fromColumn: number, toColumn: number, i: number): string {
		const x1 = cx(fromColumn);
		const y1 = cy(i);
		const x2 = cx(toColumn);
		const y2 = cy(i + 1);
		if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`;
		const ym = (y1 + y2) / 2;
		return `M${x1} ${y1} C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
	}

	function refLabel(ref: Ref): string {
		if (ref.kind === 'tag') return ref.name;
		if (ref.kind === 'head') return 'HEAD';
		return ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
	}

	function onScroll(): void {
		if (viewport) scrollTop = viewport.scrollTop;
	}

	function fmtDate(epochSeconds: number): string {
		return new Date(epochSeconds * 1000).toLocaleDateString();
	}
</script>

<div class="graph" bind:this={viewport} bind:clientHeight={viewportH} onscroll={onScroll}>
	<div class="inner" style="height:{totalH}px">
		<svg class="lines" width={graphPx} height={totalH} aria-hidden="true">
			{#each visible as v (v.row.commit.hash)}
				{#each v.row.edges as edge, e (e)}
					<path
						d={edgePath(edge.fromColumn, edge.toColumn, v.index)}
						stroke={graphColour(edge.colour)}
						stroke-width="2"
						fill="none"
					/>
				{/each}
			{/each}
			{#each visible as v (v.row.commit.hash)}
				<circle cx={cx(v.row.nodeColumn)} cy={cy(v.index)} r={NODE_R} fill={graphColour(v.row.nodeColour)} />
			{/each}
		</svg>
		{#each visible as v (v.row.commit.hash)}
			<div
				class="row"
				class:selected={v.row.commit.hash === selectedHash}
				style="top:{v.index * ROW_H}px; height:{ROW_H}px; padding-left:{graphPx}px"
				role="button"
				tabindex="0"
				title={v.row.commit.hash}
				onclick={() => onselect(v.row.commit.hash)}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') onselect(v.row.commit.hash);
				}}
				oncontextmenu={(event) => openMenu(event, v.row.commit)}
			>
				{#each v.row.commit.refs as ref, r (r)}
					<span class="ref {ref.kind}">{refLabel(ref)}</span>
				{/each}
				<span class="subject">{v.row.commit.subject}</span>
				<span class="meta">{v.row.commit.author.name} · {fmtDate(v.row.commit.committedAt)}</span>
			</div>
		{/each}
	</div>
</div>

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		items={menuItems}
		onselect={onMenuSelect}
		onclose={() => (menu = null)}
	/>
{/if}

<style>
	.graph {
		height: 100%;
		overflow: auto;
		position: relative;
	}
	.inner {
		position: relative;
	}
	.lines {
		position: absolute;
		top: 0;
		left: 0;
		overflow: visible;
		pointer-events: none;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding-right: var(--gg-space-3);
		cursor: pointer;
		overflow: hidden;
		white-space: nowrap;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		font: inherit;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.row.selected {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.subject {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	.ref {
		flex: none;
		font-size: 0.75em;
		padding: 0 var(--gg-space-1);
		border-radius: 3px;
		border: 1px solid var(--gg-border);
	}
	.ref.head {
		border-color: var(--gg-accent);
		color: var(--gg-accent);
	}
	.ref.tag {
		color: var(--vscode-gitDecoration-untrackedResourceForeground, var(--gg-fg));
	}
</style>
