<script lang="ts">
	import type { Commit, CommitActionId, GraphRow, Ref } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import type { DateFormat, GraphStyle } from '../settings/SettingsWidget.svelte';

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
		currentBranch,
		columns,
		widths,
		compareHash,
		dateFormat,
		graphStyle,
		scrollTarget,
		onselect,
		oncompare,
		onaction,
		ontoggleColumn,
		onresizeColumn,
	}: {
		rows: GraphRow[];
		selectedHash: string | null;
		currentBranch: string | null;
		columns: ColumnVisibility;
		widths: ColumnWidths;
		compareHash: string | null;
		dateFormat: DateFormat;
		graphStyle: GraphStyle;
		/** Bumping `nonce` scrolls the given hash into view. */
		scrollTarget: { hash: string; nonce: number } | null;
		onselect: (hash: string) => void;
		oncompare: (hash: string) => void;
		onaction: (action: CommitActionId, commit: Commit) => void;
		ontoggleColumn: (column: keyof ColumnVisibility) => void;
		onresizeColumn: (column: ColumnKey, width: number) => void;
	} = $props();

	const ROW_H = 24;
	const COL_W = 14;
	const PAD = 10;
	const NODE_R = 4;
	const OVERSCAN = 8;
	const MIN_COL_W = 60;

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
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

	const cx = (col: number): number => PAD + col * COL_W;
	const cy = (rowIndex: number): number => rowIndex * ROW_H + ROW_H / 2;

	function edgePath(fromColumn: number, toColumn: number, i: number): string {
		const x1 = cx(fromColumn);
		const y1 = cy(i);
		const x2 = cx(toColumn);
		const y2 = cy(i + 1);
		if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`;
		const ym = (y1 + y2) / 2;
		if (graphStyle === 'angular') return `M${x1} ${y1} L${x1} ${ym} L${x2} ${ym} L${x2} ${y2}`;
		return `M${x1} ${y1} C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
	}

	function refLabel(ref: Ref): string {
		if (ref.kind === 'tag') return ref.name;
		if (ref.kind === 'stash') return ref.name;
		if (ref.kind === 'head') return 'HEAD';
		return ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
	}

	/** Codicon hinting at the ref kind: checked-out, local branch, remote branch, tag or stash. */
	function refIcon(ref: Ref): string {
		if (ref.kind === 'tag') return 'tag';
		if (ref.kind === 'stash') return 'archive';
		if (ref.kind === 'head') return 'check';
		if (ref.remote) return 'cloud';
		return ref.name === currentBranch ? 'check' : 'git-branch';
	}

	function fmtDate(epochSeconds: number): string {
		const date = new Date(epochSeconds * 1000);
		switch (dateFormat) {
			case 'dateOnly':
				return date.toLocaleDateString();
			case 'iso':
				return date.toISOString().slice(0, 16).replace('T', ' ');
			case 'relative':
				return relative(epochSeconds);
			default:
				return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit',
				})}`;
		}
	}

	function relative(epochSeconds: number): string {
		const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
		const listUnits: [number, string][] = [
			[31536000, 'year'],
			[2592000, 'month'],
			[86400, 'day'],
			[3600, 'hour'],
			[60, 'minute'],
		];
		for (const [size, name] of listUnits) {
			if (seconds >= size) {
				const value = Math.floor(seconds / size);
				return `${value} ${name}${value === 1 ? '' : 's'} ago`;
			}
		}
		return 'just now';
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
		const target = scrollTarget;
		if (!target || !viewport) return;
		const index = rows.findIndex((row) => row.commit.hash === target.hash);
		if (index === -1) return;
		viewport.scrollTo({ top: Math.max(0, index * ROW_H - viewport.clientHeight / 2) });
	});
</script>

<svelte:window onmousemove={onResizeMove} onmouseup={() => (resizing = null)} />

<div class="graph-view">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="headers"
		style="grid-template-columns:{gridTemplate}"
		oncontextmenu={(event) => {
			event.preventDefault();
			headerMenu = { x: event.clientX, y: event.clientY };
		}}
		title="Right-click to show or hide columns"
	>
		<span class="hcell">
			Branch / Tag
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="grip" onmousedown={(event) => startResize('ref', event)}></span>
		</span>
		<span class="hcell">Graph</span>
		<span class="hcell desc">Description</span>
		{#if columns.author}
			<span class="hcell">
				Author
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="grip" onmousedown={(event) => startResize('author', event)}></span>
			</span>
		{/if}
		{#if columns.commit}
			<span class="hcell">
				Commit
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="grip" onmousedown={(event) => startResize('commit', event)}></span>
			</span>
		{/if}
		{#if columns.date}
			<span class="hcell date">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="grip left" onmousedown={(event) => startResize('date', event)}></span>
				Date
			</span>
		{/if}
	</div>

	<div class="scroll" bind:this={viewport} bind:clientHeight={viewportH} onscroll={onScroll}>
		<div class="inner" style="height:{totalH}px">
			<svg
				class="lines"
				width={graphPx}
				height={totalH}
				style="left:{widths.ref}px"
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
					class:compared={v.row.commit.hash === compareHash}
					style="top:{v.index * ROW_H}px; height:{ROW_H}px; grid-template-columns:{gridTemplate}"
					role="button"
					tabindex="0"
					title={v.row.commit.hash}
					onclick={(event) => {
						if (event.ctrlKey || event.metaKey) oncompare(v.row.commit.hash);
						else onselect(v.row.commit.hash);
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') onselect(v.row.commit.hash);
					}}
					oncontextmenu={(event) => openMenu(event, v.row.commit)}
				>
					<span class="refs">
						{#each v.row.commit.refs as ref, r (r)}
							<span class="ref {ref.kind}" title={refLabel(ref)}>
								<Icon name={refIcon(ref)} />{refLabel(ref)}
							</span>
						{/each}
					</span>
					<span class="graph-cell"></span>
					<span class="subject" class:uncommitted={v.row.commit.isUncommitted}>
						{v.row.commit.subject}
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
							{#if v.row.commit.isUncommitted}—{:else}{fmtDate(v.row.commit.committedAt)}{/if}
						</span>
					{/if}
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
		padding: 0 var(--gg-space-2) 0 0;
		border-bottom: 1px solid var(--gg-border);
		color: var(--gg-fg-muted);
	}
	.hcell {
		position: relative;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
	}
	.hcell.desc {
		justify-content: center;
	}
	.hcell.date {
		justify-content: flex-end;
	}
	.grip {
		position: absolute;
		right: calc(var(--gg-space-2) / -2 - 2px);
		top: 0;
		bottom: 0;
		width: 5px;
		cursor: col-resize;
	}
	.grip.left {
		right: auto;
		left: calc(var(--gg-space-2) / -2 - 2px);
	}
	.grip:hover {
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
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		display: grid;
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
	.row.compared {
		outline: 1px dashed var(--gg-accent);
		outline-offset: -1px;
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
	.ref :global(.codicon) {
		font-size: 12px;
		opacity: 0.85;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subject.uncommitted {
		font-weight: 600;
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
</style>
