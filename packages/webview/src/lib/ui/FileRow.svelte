<script lang="ts" module>
	import { lfs } from '../stores/lfs.svelte';
	/**
	 * A row whose actions are a union reports that union back through `onaction`. The `string`
	 * default is for the lists that show no actions at all, which have nothing to infer from.
	 */
	export interface FileRowAction<Id extends string = string> {
		id: Id;
		label: string;
		icon: string;
	}
</script>

<script lang="ts" generics="Id extends string = string">
	import type { FileChange } from '@git-octopus/shared';
	import FileIcon from './FileIcon.svelte';
	import Icon from './Icon.svelte';
	import { tooltip } from './tooltip';
	import { submoduleNotes } from '../submodule';

	let {
		file,
		active = false,
		label,
		indent = 8,
		actions = [],
		onopen,
		onaction,
		onmenu,
	}: {
		file: FileChange;
		/** Whether this is the file whose diff is open; it is highlighted and kept in view. */
		active?: boolean;
		/** Text to show instead of the full path — the file name alone in tree view. */
		label?: string;
		/** Left inset in pixels, used to show tree depth. */
		indent?: number;
		actions?: FileRowAction<Id>[];
		onopen: (path: string) => void;
		onaction?: (id: Id, path: string) => void;
		onmenu?: (event: MouseEvent, file: FileChange) => void;
	} = $props();

	// Split so the folders can be cut short while the file name stays whole — a row of paths ending
	// in "…" tells you nothing, and tree view already shows the name on its own.
	const cut = $derived(label !== undefined ? -1 : file.path.lastIndexOf('/'));
	const dir = $derived(cut === -1 ? '' : file.path.slice(0, cut + 1));
	const name = $derived(label ?? file.path.slice(cut + 1));
	const listSubmoduleNotes = $derived(file.submodule ? submoduleNotes(file.submodule) : []);

	let row = $state<HTMLLIElement | null>(null);
	$effect(() => {
		if (active) row?.scrollIntoView({ block: 'nearest' });
	});
</script>

<!-- The menu hangs off the whole row, not just the name, so right-clicking the counts or the status
	letter works too. The row's button stays the keyboard path. -->
<li
	class="file-row"
	class:active
	bind:this={row}
	oncontextmenu={onmenu
		? (event) => {
				event.preventDefault();
				onmenu(event, file);
			}
		: undefined}
>
	<button class="open" style="padding-left:{indent}px" onclick={() => onopen(file.path)}>
		{#if file.submodule}
			<Icon name="file-submodule" />
		{:else}
			<FileIcon path={file.path} fallback="file" />
		{/if}
		<span class="path"
			>{#if dir}<span class="dir">{dir}</span>{/if}<span class="name">{name}</span></span
		>
	</button>
	<!-- Ahead of the counts and the status, so appearing on hover costs the name its width and
	     nothing else: everything to the right of here keeps the column it was in. -->
	<span class="actions">
		{#each actions as action (action.id)}
			<button
				class="act"
				use:tooltip={action.label}
				aria-label={action.label}
				onclick={() => onaction?.(action.id, file.path)}
			>
				<Icon name={action.icon} />
			</button>
		{/each}
	</span>
	{#if file.submodule}
		<span
			class="lfs"
			use:tooltip={listSubmoduleNotes.length > 0
				? `Submodule — ${listSubmoduleNotes.join(', ')}. Staging records the commit it is on; nothing inside it is staged or discarded from here.`
				: 'Submodule: the change is the commit this repository points it at'}
			>{listSubmoduleNotes.length > 0 ? listSubmoduleNotes.join(' · ') : 'submodule'}</span
		>
	{:else if lfs.stores(file.path)}
		<span
			class="lfs"
			use:tooltip={'Stored by Git LFS: git keeps a pointer, the content lives on the LFS server'}
			>LFS</span
		>
	{/if}
	{#if file.additions !== undefined || file.deletions !== undefined}
		<span class="counts">
			{#if file.additions}<span class="add">+{file.additions}</span>{/if}
			{#if file.deletions}<span class="del">−{file.deletions}</span>{/if}
		</span>
	{/if}
	<!-- Kept out of the name column: in tree view a leading letter pushes every file name off the
	     indent its folder sets, so the status sits in a column of its own on the right. -->
	<span class="st st-{file.status}">{file.status}</span>
</li>

<style>
	.file-row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		margin: 0 var(--gg-row-inset);
		padding-right: var(--gg-space-2);
		border-radius: var(--gg-radius);
		transition: background-color 60ms var(--gg-ease);
	}
	.file-row:hover {
		background: var(--gg-bg-hover);
	}
	.file-row.active {
		background: var(--gg-bg-selected);
		color: var(--gg-fg-selected);
	}
	.open {
		flex: 1;
		display: flex;
		align-items: center;
		/* Same gap a folder row puts after its icon, so names line up down the tree. */
		gap: var(--gg-space-1);
		min-width: 0;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		padding: 2px var(--gg-space-2);
	}
	.st {
		flex: none;
		width: 1.1em;
		text-align: center;
		font-weight: 600;
		font-size: var(--gg-text-sm);
	}
	.st-A,
	.st-\? {
		color: var(--gg-added);
	}
	.st-M {
		color: var(--gg-modified);
	}
	.st-D {
		color: var(--gg-deleted);
	}
	.st-U {
		color: var(--gg-conflict);
	}
	.path {
		display: flex;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	/*
	 * When the hover buttons appear the row loses width, and the folders give it up first: the huge
	 * shrink factor means the deficit lands almost entirely on `.dir` until it has nothing left, and
	 * only then does the file name start eliding. Both end in "…" rather than being cut off.
	 */
	.dir {
		flex: 0 1000 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lfs {
		flex: none;
		padding: 0 4px;
		font-size: var(--gg-text-xs);
		line-height: 14px;
		color: var(--gg-fg-muted);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius-sm);
	}
	.name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.counts {
		flex: none;
		display: flex;
		gap: var(--gg-space-1);
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-xs);
	}
	.add {
		color: var(--gg-added);
	}
	.del {
		color: var(--gg-deleted);
	}
	/*
	 * Out of the layout until the row is hovered, rather than merely invisible: keeping the space
	 * reserved left a blank strip down the panel on every row, and the file name is worth more than
	 * a gap held open for buttons nobody is reaching for. `focus-within` keeps them tabbable.
	 */
	.actions {
		flex: none;
		display: none;
		gap: 2px;
	}
	.file-row:hover .actions,
	.file-row:focus-within .actions {
		display: flex;
	}
	.act {
		display: inline-flex;
		align-items: center;
		background: none;
		border: none;
		color: var(--gg-fg-muted);
		cursor: pointer;
		padding: 0 var(--gg-space-1);
		line-height: 1;
	}
	.act:hover {
		color: var(--gg-fg);
	}
</style>
