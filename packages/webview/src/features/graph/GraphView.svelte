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

	/** Taller than the text needs, so the lane curves have room to read as smooth transitions. */
	const ROW_H = 34;
	const COL_W = 20;
	const PAD = 12;
	const NODE_R = 5;
	/** Radius used when a commit shows its author's avatar instead of a plain dot. */
	const AVATAR_R = 9;
	const OVERSCAN = 8;
	const MIN_COL_W = 60;
	const MAX_CHIPS = 3;

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

	interface RefChip {
		kind: 'branch' | 'tag' | 'stash';
		name: string;
		checkedOut: boolean;
		hasLocal: boolean;
		listRemotes: string[];
		title: string;
	}

	/**
	 * Collapse a commit's refs into compact chips: a branch present both locally and on remotes
	 * becomes one chip carrying both markers, and the standalone HEAD ref is folded into a tick on
	 * the checked-out branch instead of taking a chip of its own.
	 */
	function buildChips(refs: Ref[]): RefChip[] {
		const mapBranches = new Map<string, RefChip>();
		const listOthers: RefChip[] = [];

		for (const ref of refs) {
			if (ref.kind === 'head') continue;
			if (ref.kind === 'tag' || ref.kind === 'stash') {
				listOthers.push({
					kind: ref.kind,
					name: ref.name,
					checkedOut: false,
					hasLocal: false,
					listRemotes: [],
					title: ref.kind === 'tag' ? `Tag ${ref.name}` : `Stash ${ref.name}`,
				});
				continue;
			}
			const chip = mapBranches.get(ref.name) ?? {
				kind: 'branch' as const,
				name: ref.name,
				checkedOut: false,
				hasLocal: false,
				listRemotes: [],
				title: '',
			};
			if (ref.remote) chip.listRemotes.push(ref.remote);
			else chip.hasLocal = true;
			mapBranches.set(ref.name, chip);
		}

		for (const chip of mapBranches.values()) {
			chip.checkedOut = chip.hasLocal && chip.name === currentBranch;
			const listParts: string[] = [];
			if (chip.hasLocal) listParts.push(chip.checkedOut ? 'checked out' : 'local branch');
			for (const remote of chip.listRemotes) listParts.push(`${remote}/${chip.name}`);
			chip.title = `${chip.name} — ${listParts.join(', ')}`;
		}

		return [...mapBranches.values(), ...listOthers];
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
		<span class="hcell indent">
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
		<span class="hcell desc">
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
			<span class="hcell date">
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
					{@const commit = v.row.commit}
					{@const isMerge = commit.parents.length > 1}
					{@const avatar = !commit.isUncommitted && !isMerge ? commit.author.avatarUrl : undefined}
					{#if commit.isUncommitted}
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R}
							fill="none"
							stroke={graphColour(v.row.nodeColour)}
							stroke-width="2"
						/>
					{:else if avatar}
						<clipPath id="gg-clip-{commit.hash}">
							<circle cx={cx(v.row.nodeColumn)} cy={cy(v.index)} r={AVATAR_R} />
						</clipPath>
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={AVATAR_R}
							fill={graphColour(v.row.nodeColour)}
						/>
						<image
							href={avatar}
							x={cx(v.row.nodeColumn) - AVATAR_R}
							y={cy(v.index) - AVATAR_R}
							width={AVATAR_R * 2}
							height={AVATAR_R * 2}
							clip-path="url(#gg-clip-{commit.hash})"
							preserveAspectRatio="xMidYMid slice"
						/>
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={AVATAR_R}
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
				{@const listChips = buildChips(v.row.commit.refs)}
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
						{#each listChips.slice(0, MAX_CHIPS) as chip (chip.kind + chip.name)}
							<span
								class="ref {chip.kind}"
								class:current={chip.checkedOut}
								title={chip.title}
								style={chip.kind === 'branch'
									? `border-color:${graphColour(v.row.nodeColour)}`
									: undefined}
							>
								{#if chip.checkedOut}<Icon name="check" />{/if}
								{#if chip.kind === 'tag'}<Icon name="tag" />{/if}
								{#if chip.kind === 'stash'}<Icon name="archive" />{/if}
								<span class="ref-name">{chip.name}</span>
								{#if chip.hasLocal && !chip.checkedOut}<Icon name="device-desktop" />{/if}
								{#if chip.listRemotes.length > 0}<Icon name="cloud" />{/if}
							</span>
						{/each}
						{#if listChips.length > MAX_CHIPS}
							<span
								class="ref more"
								title={listChips
									.slice(MAX_CHIPS)
									.map((chip) => chip.name)
									.join('\n')}
							>
								+{listChips.length - MAX_CHIPS}
							</span>
						{/if}
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
		white-space: nowrap;
		min-width: 0;
	}
	.hlabel {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Matches the left inset of the ref chips so the header lines up with the rows below. */
	.hcell.indent {
		padding-left: var(--gg-space-2);
	}
	.hcell.desc {
		justify-content: center;
	}
	.hcell.date {
		justify-content: flex-end;
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
	.row.selected .subject,
	.row.selected .muted {
		color: inherit;
	}
	.row.compared {
		outline: 1px dashed var(--gg-accent);
		outline-offset: -1px;
	}
	.refs {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		overflow: hidden;
		padding-left: var(--gg-space-2);
		justify-content: flex-end;
	}
	.ref {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		min-width: 0;
		flex: 0 1 auto;
		font-size: 0.85em;
		line-height: 1.6;
		padding: 0 var(--gg-space-1);
		border-radius: 4px;
		border: 1px solid var(--gg-border);
		background: var(--vscode-editorWidget-background, transparent);
	}
	.ref-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ref.current {
		font-weight: 600;
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.ref.current :global(.codicon) {
		opacity: 1;
	}
	.ref.more {
		flex: none;
		color: var(--gg-fg-muted);
	}
	.ref :global(.codicon) {
		flex: none;
		font-size: 11px;
		opacity: 0.8;
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
