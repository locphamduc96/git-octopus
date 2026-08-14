<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { FileTreeNode } from '../fileTree';
	import FileRow, { type FileRowAction } from './FileRow.svelte';
	import Icon from './Icon.svelte';

	let {
		nodes,
		actions = [],
		onopen,
		onaction,
	}: {
		nodes: FileTreeNode[];
		actions?: FileRowAction[];
		onopen: (path: string) => void;
		onaction?: (id: string, path: string) => void;
	} = $props();

	/** Folders start open, so a diff is readable at a glance; this holds the ones folded away. */
	const setCollapsed = new SvelteSet<string>();

	/**
	 * What a folder spends before its name: chevron + gap + icon + gap. A file row is inset by this
	 * much so its name starts exactly where a folder name at the same depth would. The two icons are
	 * pinned to 16px in the stylesheet below, since codicon glyphs are not all the same width.
	 */
	const LABEL_INSET = 16 + 4 + 16 + 4;

	function toggle(path: string): void {
		if (setCollapsed.has(path)) setCollapsed.delete(path);
		else setCollapsed.add(path);
	}
</script>

{#snippet branch(listNodes: FileTreeNode[], depth: number)}
	{#each listNodes as node (node.kind === 'folder' ? `d:${node.path}` : `f:${node.file.path}`)}
		{#if node.kind === 'folder'}
			{@const collapsed = setCollapsed.has(node.path)}
			<li>
				<button
					class="folder"
					style="padding-left:{depth * 12 + 8}px"
					onclick={() => toggle(node.path)}
					title={node.path}
				>
					<Icon name={collapsed ? 'chevron-right' : 'chevron-down'} />
					<Icon name={collapsed ? 'folder' : 'folder-opened'} />
					<span class="name">{node.name}</span>
				</button>
			</li>
			{#if !collapsed}
				{@render branch(node.children, depth + 1)}
			{/if}
		{:else}
			<FileRow
				file={node.file}
				label={node.name}
				indent={depth * 12 + 8 + LABEL_INSET}
				{actions}
				{onopen}
				{onaction}
			/>
		{/if}
	{/each}
{/snippet}

<ul>
	{@render branch(nodes, 0)}
</ul>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.folder {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		padding-top: 2px;
		padding-bottom: 2px;
		padding-right: var(--gg-space-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.folder:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.folder :global(.codicon) {
		flex: none;
		/* A codicon is 16px tall but its glyphs are not all 16px wide — a folder is ~6px narrower
		   than a chevron. Pinning the box keeps LABEL_INSET honest, and keeps folder names from
		   shifting as rows expand and collapse. */
		width: 16px;
		opacity: 0.8;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
