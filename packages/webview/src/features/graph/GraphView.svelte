<script lang="ts">
	import type { Commit, CommitActionId, GraphRow, Ref } from '@git-octopus/shared';
	import { graphWidth } from '@git-octopus/graph-layout';
	import { graphColour } from '../../lib/graphColours';
	import { parseSubject, typeColour } from '../../lib/commitSubject';
	import { tooltip } from '../../lib/ui/tooltip';
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
		oncheckoutBranch,
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
		/** Check out a branch chip: a local name when there is one, otherwise a remote-tracking one. */
		oncheckoutBranch: (local: string | null, remote: string | null) => void;
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
	/** Lane lines are drawn hairline-thin: a graph this dense turns to mush at any real weight. */
	const EDGE_W = 1.5;
	/** Codicon glyph for `archive`, drawn inside the stash node. */
	const STASH_GLYPH = '';
	const OVERSCAN = 8;
	const MIN_COL_W = 60;
	const MAX_CHIPS = 3;

	/** Breathing room so the overlay scrollbar never sits on top of the Date column. */
	const SCROLL_GUTTER = 8;

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	let viewportW = $state(0);

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

	const cx = (col: number): number => PAD + col * COL_W;
	const cy = (rowIndex: number): number => rowIndex * ROW_H + ROW_H / 2;

	/**
	 * A line from row `i` down to the next row.
	 *
	 * A lane that changes column bends **once**, and the bend belongs to whichever end sits at a
	 * node. Forcing both ends vertical — as a line between two nodes would want — costs two
	 * reversals of curvature, and a screen full of those reads as weaving rather than as branches.
	 * So the straight run belongs to the lane, and the single quarter turn belongs to the node,
	 * which the line therefore enters or leaves sideways.
	 *
	 * `fromNode` says this row's node is the upper end.
	 */
	function edgePath(fromColumn: number, toColumn: number, i: number, fromNode: boolean): string {
		const x1 = cx(fromColumn);
		const x2 = cx(toColumn);
		const yTop = cy(i);
		const yBottom = cy(i + 1);

		// Straight down: still start at the node's rim, since the hollow nodes would otherwise show
		// the line running out of their centre.
		if (x1 === x2) return `M${x1} ${yTop + (fromNode ? NODE_R : 0)} L${x2} ${yBottom}`;

		const dir = Math.sign(x2 - x1);
		if (graphStyle === 'angular') {
			const ym = (yTop + yBottom) / 2;
			return `M${x1} ${yTop} L${x1} ${ym} L${x2} ${ym} L${x2} ${yBottom}`;
		}

		if (fromNode) {
			// Out of the node sideways, one turn, then straight down the lane it is joining.
			const startX = x1 + dir * NODE_R;
			const r = Math.min(Math.abs(x2 - startX), yBottom - yTop);
			return `M${startX} ${yTop} Q${x2} ${yTop} ${x2} ${yTop + r} L${x2} ${yBottom}`;
		}
		// Straight down this lane, then one turn into the column it is converging on.
		const r = Math.min(Math.abs(x2 - x1), yBottom - yTop);
		return `M${x1} ${yTop} L${x1} ${yBottom - r} Q${x1} ${yBottom} ${x2} ${yBottom}`;
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

{#snippet chipBody(chip: RefChip)}
	{#if chip.checkedOut}<Icon name="check" />{/if}
	{#if chip.kind === 'tag'}<Icon name="tag" />{/if}
	{#if chip.kind === 'stash'}<Icon name="archive" />{/if}
	<span class="ref-name">{chip.name}</span>
	{#if chip.hasLocal}<Icon name="device-desktop" />{/if}
	{#if chip.listRemotes.length > 0}<Icon name="cloud" />{/if}
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

	<div
		class="scroll"
		bind:this={viewport}
		bind:clientHeight={viewportH}
		bind:clientWidth={viewportW}
		onscroll={onScroll}
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
					{@const fromStash = v.row.commit.refs.some((ref) => ref.kind === 'stash')}
					{#each v.row.edges as edge, e (e)}
						<path
							d={edgePath(
								edge.fromColumn,
								edge.toColumn,
								v.index,
								edge.fromColumn === v.row.nodeColumn
							)}
							stroke={graphColour(edge.colour)}
							stroke-width={EDGE_W}
							stroke-dasharray={fromStash && edge.fromColumn === v.row.nodeColumn
								? '3 3'
								: undefined}
							fill="none"
						/>
					{/each}
				{/each}
				{#each visible as v (v.row.commit.hash)}
					{@const commit = v.row.commit}
					{@const isMerge = commit.parents.length > 1}
					{@const isStash = commit.refs.some((ref) => ref.kind === 'stash')}
					{@const avatar =
						!commit.isUncommitted && !isMerge && !isStash ? commit.author.avatarUrl : undefined}
					{#if isStash}
						<text
							x={cx(v.row.nodeColumn)}
							y={cy(v.index)}
							fill={graphColour(v.row.nodeColour)}
							font-family="codicon"
							font-size="16"
							text-anchor="middle"
							dominant-baseline="central">{STASH_GLYPH}</text
						>
					{:else if commit.isUncommitted}
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R}
							fill="none"
							stroke={graphColour(v.row.nodeColour)}
							stroke-width={EDGE_W}
						/>
					{:else if isMerge}
						<!-- A ring with a dot in it: a merge has no single author worth showing, and the
						     shape reads as "two lines met here" at a glance. -->
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R}
							fill="none"
							stroke={graphColour(v.row.nodeColour)}
							stroke-width={EDGE_W}
						/>
						<circle
							cx={cx(v.row.nodeColumn)}
							cy={cy(v.index)}
							r={NODE_R - 3}
							fill={graphColour(v.row.nodeColour)}
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
				{@const parsed = parseSubject(v.row.commit.subject)}
				<div
					class="row"
					class:selected={v.row.commit.hash === selectedHash}
					class:compared={v.row.commit.hash === compareHash}
					style="top:{v.index * ROW_H}px; height:{ROW_H}px; grid-template-columns:{gridTemplate};
						padding-right:{SCROLL_GUTTER}px"
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
							{@const border =
								chip.kind === 'branch'
									? `border-color:${graphColour(v.row.nodeColour)}`
									: undefined}
							{#if chip.kind === 'branch' && !chip.checkedOut}
								<button
									class="ref branch checkoutable"
									use:tooltip={`${chip.title} — double-click to check out`}
									ondblclick={(event) => {
										event.stopPropagation();
										oncheckoutBranch(
											chip.hasLocal ? chip.name : null,
											chip.listRemotes.length > 0 ? `${chip.listRemotes[0]}/${chip.name}` : null
										);
									}}
									onkeydown={(event) => {
										if (event.key !== 'Enter') return;
										event.stopPropagation();
										oncheckoutBranch(
											chip.hasLocal ? chip.name : null,
											chip.listRemotes.length > 0 ? `${chip.listRemotes[0]}/${chip.name}` : null
										);
									}}
									style={border}
								>
									{@render chipBody(chip)}
								</button>
							{:else}
								<span
									class="ref {chip.kind}"
									class:current={chip.checkedOut}
									use:tooltip={chip.title}
									style={border}
								>
									{@render chipBody(chip)}
								</span>
							{/if}
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
						{#if v.row.commit.parents.length > 1}<span
								class="type"
								style="color:{typeColour('merge')}; border-color:{typeColour('merge')}"
								use:tooltip={`Merge commit — ${v.row.commit.parents.length} parents`}
								>merge</span
							>{/if}{#if parsed.ticket}<span class="ticket">{parsed.ticket}</span>{/if}{#if parsed.type}<span
								class="type"
								style="color:{typeColour(parsed.type)}; border-color:{typeColour(parsed.type)}"
								>{parsed.type}{parsed.scope ? `(${parsed.scope})` : ''}</span
							>{/if}{parsed.text}
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
		font-size: var(--gg-chip-font-size);
		line-height: var(--gg-chip-line-height);
		padding: var(--gg-chip-padding);
		border-radius: var(--gg-chip-radius);
		border: 1px solid var(--gg-border);
		background: var(--vscode-editorWidget-background, transparent);
	}
	.ref-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ref.checkoutable {
		cursor: pointer;
		/* A <button> falls back to the browser's own font; only the family needs restoring, since
		   `font: inherit` would also drop the chip's size and line height. */
		font-family: inherit;
		color: inherit;
	}
	.ref.checkoutable:hover {
		background: var(--vscode-list-hoverBackground);
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
