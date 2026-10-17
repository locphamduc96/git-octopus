<script lang="ts">
	/**
	 * The ref panel: every branch, remote branch, tag, stash, worktree and submodule of the
	 * repository in one tree beside the graph. It only draws and reports — what a click or a
	 * right-click does is the parent's to decide, through the event props.
	 */
	import type { HiddenRefs, RepoInfo, WorktreeInfo } from '@git-octopus/shared';
	import Icon from '../../lib/ui/Icon.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import RefIcon from '../../lib/ui/RefIcon.svelte';
	import {
		buildRefPanel,
		flattenRefPanel,
		type RefPanelData,
		type RefPanelItem,
		type RefPanelKind,
		type RefPanelRow,
	} from './refPanelModel';

	let {
		data,
		listWorktrees,
		listSubmodules,
		hidden,
		listCollapsed,
		oncollapsechange,
		onselect,
		onactivate,
		oncontextmenu,
		ondragstart,
		ontogglehidden,
	}: {
		data: RefPanelData;
		listWorktrees: WorktreeInfo[];
		/** The submodules of the repository on show, not those of the repositories above it. */
		listSubmodules: RepoInfo[];
		hidden: HiddenRefs;
		/** Keys of the sections and folders that are folded away. */
		listCollapsed: string[];
		oncollapsechange: (listCollapsed: string[]) => void;
		/** A click, or Enter on the focused row. */
		onselect: (item: RefPanelItem) => void;
		/** A double-click. */
		onactivate: (item: RefPanelItem) => void;
		oncontextmenu: (item: RefPanelItem, event: MouseEvent) => void;
		ondragstart: (item: RefPanelItem, event: DragEvent) => void;
		ontogglehidden: (item: RefPanelItem) => void;
	} = $props();

	const mapKindIcon: Record<RefPanelKind, string> = {
		local: 'git-branch',
		remote: 'git-branch',
		tag: 'tag',
		stash: 'archive',
		worktree: 'folder',
		submodule: 'file-submodule',
	};
	const setHideable = new Set<RefPanelKind>(['local', 'remote', 'tag']);

	let filter = $state('');
	let focusKey = $state<string | null>(null);
	let selectedKey = $state<string | null>(null);
	let setCollapsed = $derived(new Set(listCollapsed));
	let tree = $state<HTMLElement | null>(null);

	const filtering = $derived(filter.trim() !== '');
	const listSections = $derived(
		buildRefPanel({ data, listWorktrees, listSubmodules, hidden, filter })
	);
	const listRows = $derived(flattenRefPanel(listSections, setCollapsed, filtering));
	const tabKey = $derived(
		listRows.some((row) => row.key === focusKey) ? focusKey : (listRows[0]?.key ?? null)
	);

	function toggle(key: string): void {
		if (filtering) return;
		const next = new Set(setCollapsed);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setCollapsed = next;
		oncollapsechange([...next]);
	}

	function setOpen(key: string, open: boolean): void {
		if (setCollapsed.has(key) === !open) return;
		toggle(key);
	}

	function focusRow(key: string): void {
		focusKey = key;
		const listElements = tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
		for (const element of listElements) {
			if (element.dataset.key === key) {
				element.focus();
				element.scrollIntoView?.({ block: 'nearest' });
				return;
			}
		}
	}

	function choose(row: RefPanelRow): void {
		focusKey = row.key;
		if (row.type === 'item') {
			selectedKey = row.key;
			onselect(row.item);
		} else toggle(row.key);
	}

	function onkeydown(event: KeyboardEvent, row: RefPanelRow): void {
		if (event.target !== event.currentTarget) return;
		const at = listRows.findIndex((entry) => entry.key === row.key);
		const move = (index: number): void => {
			const target = listRows[Math.min(Math.max(index, 0), listRows.length - 1)];
			if (target) focusRow(target.key);
		};
		switch (event.key) {
			case 'ArrowDown':
				move(at + 1);
				break;
			case 'ArrowUp':
				move(at - 1);
				break;
			case 'Home':
				move(0);
				break;
			case 'End':
				move(listRows.length - 1);
				break;
			case 'ArrowRight':
				if (row.type !== 'item') setOpen(row.key, true);
				break;
			case 'ArrowLeft':
				if (row.type !== 'item') setOpen(row.key, false);
				break;
			case 'Enter':
			case ' ':
				choose(row);
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function onfilterkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && filter !== '') {
			filter = '';
			event.preventDefault();
			event.stopPropagation();
		} else if (event.key === 'ArrowDown' && listRows.length > 0) {
			focusRow(tabKey ?? listRows[0].key);
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function titleOf(item: RefPanelItem): string {
		return item.hash ? `${item.name} · ${item.hash.slice(0, 7)}` : item.name;
	}
</script>

<div class="ref-panel">
	<div class="filter-bar">
		<Icon name="filter" />
		<input
			type="text"
			placeholder="Filter refs"
			aria-label="Filter refs"
			spellcheck="false"
			autocomplete="off"
			bind:value={filter}
			onkeydown={onfilterkeydown}
		/>
		{#if filter !== ''}
			<IconButton name="close" label="Clear filter" onclick={() => (filter = '')} />
		{/if}
	</div>

	<div class="tree" role="tree" aria-label="Refs" bind:this={tree}>
		{#each listRows as row (row.key)}
			{#if row.type === 'section'}
				<div
					class="row section"
					role="treeitem"
					aria-level={1}
					aria-expanded={row.expanded}
					aria-selected="false"
					aria-label="{row.title} ({row.count})"
					data-key={row.key}
					tabindex={tabKey === row.key ? 0 : -1}
					onclick={() => choose(row)}
					onfocus={() => (focusKey = row.key)}
					onkeydown={(event) => onkeydown(event, row)}
				>
					<span class="twist"><Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} /></span>
					<span class="title">{row.title}</span>
					<span class="count">{row.count}</span>
				</div>
			{:else if row.type === 'folder'}
				<div
					class="row folder"
					role="treeitem"
					aria-level={row.depth + 1}
					aria-expanded={row.expanded}
					aria-selected="false"
					aria-label="{row.name} ({row.count})"
					data-key={row.key}
					style="padding-left:{row.depth * 12 + 8}px"
					tabindex={tabKey === row.key ? 0 : -1}
					onclick={() => choose(row)}
					onfocus={() => (focusKey = row.key)}
					onkeydown={(event) => onkeydown(event, row)}
				>
					<span class="twist"><Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} /></span>
					<span class="kind"
						>{#if row.isRemote}<RefIcon name="cloud" />{:else}<Icon
								name={row.expanded ? 'folder-opened' : 'folder'}
							/>{/if}</span
					>
					<span class="label">{row.name}</span>
					<span class="count">{row.count}</span>
				</div>
			{:else}
				{@const item = row.item}
				<div
					class="row item kind-{item.kind}"
					class:selected={selectedKey === row.key}
					class:hidden={item.hidden}
					class:current={item.current}
					role="treeitem"
					aria-level={row.depth + 1}
					aria-selected={selectedKey === row.key}
					aria-current={item.current ? 'true' : undefined}
					aria-label={item.detail ? `${item.name} — ${item.detail}` : item.name}
					data-key={row.key}
					title={titleOf(item)}
					style="padding-left:{row.depth * 12 + 8}px"
					tabindex={tabKey === row.key ? 0 : -1}
					draggable={setHideable.has(item.kind)}
					onclick={() => choose(row)}
					ondblclick={(event) => {
						if ((event.target as Element).closest('.toggle')) return;
						onactivate(item);
					}}
					oncontextmenu={(event) => {
						event.preventDefault();
						oncontextmenu(item, event);
					}}
					ondragstart={(event) => ondragstart(item, event)}
					onfocus={() => (focusKey = row.key)}
					onkeydown={(event) => onkeydown(event, row)}
				>
					<span class="twist"></span>
					<span class="kind"><Icon name={mapKindIcon[item.kind]} /></span>
					<span class="label">{item.label}</span>
					{#if item.detail}<span class="detail">{item.detail}</span>{/if}
					{#if item.current}
						<span
							class="mark"
							title={item.kind === 'worktree' ? 'Open in this window' : 'Checked out'}
							><RefIcon name="check" /></span
						>
					{/if}
					{#if setHideable.has(item.kind)}
						<span class="toggle" class:on={item.hidden}>
							<IconButton
								name={item.hidden ? 'eye-closed' : 'eye'}
								label={item.hidden
									? `Show ${item.name} in the graph`
									: `Hide ${item.name} from the graph`}
								onclick={(event) => {
									event.stopPropagation();
									ontogglehidden(item);
								}}
							/>
						</span>
					{/if}
				</div>
			{/if}
		{:else}
			<p class="empty">{filtering ? 'No refs match the filter' : 'No refs yet'}</p>
		{/each}
	</div>
</div>

<style>
	.ref-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--gg-bg-sidebar);
		color: var(--gg-fg);
		font-size: var(--gg-text-md);
	}
	.filter-bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		height: var(--gg-header-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		color: var(--gg-fg-muted);
	}
	.filter-bar input {
		flex: 1;
		min-width: 0;
		height: var(--gg-hit);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		font: inherit;
		color: var(--gg-input-fg);
		background: var(--gg-input-bg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
	}
	.filter-bar input:focus {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	.tree {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding-bottom: var(--gg-space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		margin: 0 var(--gg-row-inset);
		padding: 2px var(--gg-space-2);
		min-height: var(--gg-hit);
		box-sizing: border-box;
		border-radius: var(--gg-radius);
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
		transition: background-color 60ms var(--gg-ease);
	}
	.row:hover {
		background: var(--gg-bg-hover);
	}
	.row:focus-visible {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	.row.selected {
		background: var(--gg-bg-selected);
		color: var(--gg-fg-selected);
	}
	.section {
		margin-top: var(--gg-space-1);
		font-size: var(--gg-text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--gg-fg-muted);
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.twist,
	.kind {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--gg-icon-md);
		height: var(--gg-icon-md);
		line-height: 0;
	}
	.kind {
		opacity: 0.85;
	}
	.kind-tag .kind {
		color: var(--gg-tag);
	}
	.kind-stash .kind {
		color: var(--gg-stash);
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.folder .label {
		flex: 1;
	}
	.item .label {
		flex: 0 1 auto;
	}
	.detail {
		flex: 1 1 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gg-text-sm);
		color: var(--gg-fg-muted);
	}
	.selected .detail {
		color: inherit;
		opacity: 0.8;
	}
	.item:not(:has(.detail)) .label {
		flex: 1 1 auto;
	}
	.count {
		flex: none;
		font-size: var(--gg-text-xs);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--gg-fg-subtle);
	}
	.current .label {
		font-weight: 600;
	}
	.mark {
		flex: none;
		display: inline-flex;
		align-items: center;
		color: var(--gg-success);
	}
	.item.hidden .label,
	.item.hidden .kind {
		opacity: 0.5;
	}
	.toggle {
		flex: none;
		display: inline-flex;
		margin: -2px 0;
		opacity: 0;
		transition: opacity 60ms var(--gg-ease);
	}
	.toggle.on,
	.row:hover .toggle,
	.row:focus-within .toggle {
		opacity: 1;
	}
	.empty {
		margin: 0;
		padding: var(--gg-space-3) var(--gg-space-4);
		color: var(--gg-fg-muted);
	}
</style>
