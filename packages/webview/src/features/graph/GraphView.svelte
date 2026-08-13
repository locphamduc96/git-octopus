<script lang="ts">
	import type { Commit, CommitActionId, GraphRow, Ref } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';

	let {
		rows,
		selectedHash,
		currentBranch,
		onselect,
		onaction,
	}: {
		rows: GraphRow[];
		selectedHash: string | null;
		currentBranch: string | null;
		onselect: (hash: string) => void;
		onaction: (action: CommitActionId, commit: Commit) => void;
	} = $props();

	const ROW_H = 24;
	const COL_W = 14;
	const PAD = 10;
	const NODE_R = 4;
	const OVERSCAN = 8;
	const REF_W = 180;
	const DATE_W = 150;

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	let menu = $state<{ x: number; y: number; commit: Commit } | null>(null);

	const cols = $derived(graphWidth(rows));
	const graphPx = $derived(cols * COL_W + PAD);
	const totalH = $derived(rows.length * ROW_H);
	const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
	const end = $derived(
		Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
	);
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
		if (ref.kind === 'stash') return ref.name;
		if (ref.kind === 'head') return 'HEAD';
		return ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
	}

	/** Glyph hinting at the ref kind: checked-out, local branch, remote branch or tag. */
	function refGlyph(ref: Ref): string {
		if (ref.kind === 'tag') return '🏷';
		if (ref.kind === 'stash') return '📦';
		if (ref.kind === 'head') return '✔';
		if (ref.remote) return '☁';
		return ref.name === currentBranch ? '✔' : '🖥';
	}

	function fmtDate(epochSeconds: number): string {
		const date = new Date(epochSeconds * 1000);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})}`;
	}

	function openMenu(event: MouseEvent, commit: Commit): void {
		event.preventDefault();
		onselect(commit.hash);
		if (commit.isUncommitted) return;
		menu = { x: event.clientX, y: event.clientY, commit };
	}

	const menuItems = $derived.by(() => {
		if (!menu) return [];
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
		const items: { id: string; label: string; separatorBefore?: boolean }[] = [
			{ id: 'checkout', label: 'Checkout Commit' },
			{ id: 'createBranch', label: 'Create Branch…' },
			{ id: 'addTag', label: 'Add Tag…' },
			{ id: 'merge', label: 'Merge into current branch…', separatorBefore: true },
			{ id: 'rebase', label: 'Rebase current branch on this Commit…' },
			{ id: 'cherryPick', label: 'Cherry Pick…' },
			{ id: 'revert', label: 'Revert…' },
			{ id: 'reset', label: 'Reset current branch to this Commit…' },
		];
		if (hasLocalBranch)
			items.push({ id: 'deleteBranch', label: 'Delete Branch…', separatorBefore: true });
		items.push({ id: 'copyHash', label: 'Copy Commit Hash', separatorBefore: true });
		items.push({ id: 'copySubject', label: 'Copy Subject' });
		return items;
	});

	function onMenuSelect(id: string): void {
		const commit = menu?.commit;
		menu = null;
		if (commit) onaction(id as CommitActionId, commit);
	}

	function onScroll(): void {
		if (viewport) scrollTop = viewport.scrollTop;
	}
</script>

<div class="graph-view">
	<div class="headers" style="--ref-w:{REF_W}px; --graph-w:{graphPx}px; --date-w:{DATE_W}px">
		<span>Branch / Tag</span>
		<span>Graph</span>
		<span class="desc">Description</span>
		<span class="date">Date</span>
	</div>

	<div class="scroll" bind:this={viewport} bind:clientHeight={viewportH} onscroll={onScroll}>
		<div class="inner" style="height:{totalH}px">
			<svg
				class="lines"
				width={graphPx}
				height={totalH}
				style="left:{REF_W}px"
				aria-hidden="true"
			>
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
					{#if v.row.commit.isUncommitted}
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R}
							fill="none"
							stroke={graphColour(v.row.nodeColour)}
							stroke-width="2"
						/>
					{:else}
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R}
							fill={graphColour(v.row.nodeColour)}
						/>
					{/if}
				{/each}
			</svg>

			{#each visible as v (v.row.commit.hash)}
				<div
					class="row"
					class:selected={v.row.commit.hash === selectedHash}
					style="top:{v.index * ROW_H}px; height:{ROW_H}px;
						--ref-w:{REF_W}px; --graph-w:{graphPx}px; --date-w:{DATE_W}px"
					role="button"
					tabindex="0"
					title={v.row.commit.hash}
					onclick={() => onselect(v.row.commit.hash)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') onselect(v.row.commit.hash);
					}}
					oncontextmenu={(event) => openMenu(event, v.row.commit)}
				>
					<span class="refs">
						{#each v.row.commit.refs as ref, r (r)}
							<span class="ref {ref.kind}" title={refLabel(ref)}>
								<span class="glyph">{refGlyph(ref)}</span>{refLabel(ref)}
							</span>
						{/each}
					</span>
					<span class="graph-cell"></span>
					<span class="subject" class:uncommitted={v.row.commit.isUncommitted}>
						{v.row.commit.subject}
					</span>
					<span class="date">
						{#if v.row.commit.isUncommitted}—{:else}{fmtDate(v.row.commit.committedAt)}{/if}
					</span>
				</div>
			{/each}
		</div>
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
	.graph-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.headers {
		display: grid;
		grid-template-columns: var(--ref-w) var(--graph-w) 1fr var(--date-w);
		gap: var(--gg-space-2);
		flex: none;
		padding: var(--gg-space-1) var(--gg-space-2) var(--gg-space-1) 0;
		border-bottom: 1px solid var(--gg-border);
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	.headers .desc {
		text-align: center;
	}
	.headers .date {
		text-align: right;
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
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		display: grid;
		grid-template-columns: var(--ref-w) var(--graph-w) 1fr var(--date-w);
		align-items: center;
		gap: var(--gg-space-2);
		padding-right: var(--gg-space-2);
		cursor: pointer;
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
	.refs {
		display: flex;
		gap: var(--gg-space-1);
		overflow: hidden;
		padding-left: var(--gg-space-1);
	}
	.ref {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.78em;
		padding: 0 var(--gg-space-1);
		border-radius: 3px;
		border: 1px solid var(--gg-border);
	}
	.ref.head {
		border-color: var(--gg-accent);
		color: var(--gg-accent);
	}
	.glyph {
		opacity: 0.8;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subject.uncommitted {
		font-weight: 600;
	}
	.date {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
