<script lang="ts">
	import type { FileChange } from '@git-octopus/shared';
	import FileIcon from './FileIcon.svelte';
	import Icon from './Icon.svelte';
	import { tooltip } from './tooltip';

	export interface FileRowAction {
		id: string;
		label: string;
		icon: string;
	}

	let {
		file,
		label,
		indent = 8,
		actions = [],
		onopen,
		onaction,
		onmenu,
	}: {
		file: FileChange;
		/** Text to show instead of the full path — the file name alone in tree view. */
		label?: string;
		/** Left inset in pixels, used to show tree depth. */
		indent?: number;
		actions?: FileRowAction[];
		onopen: (path: string) => void;
		onaction?: (id: string, path: string) => void;
		onmenu?: (event: MouseEvent, file: FileChange) => void;
	} = $props();

	// Split so the folders can be cut short while the file name stays whole — a row of paths ending
	// in "…" tells you nothing, and tree view already shows the name on its own.
	const cut = $derived(label !== undefined ? -1 : file.path.lastIndexOf('/'));
	const dir = $derived(cut === -1 ? '' : file.path.slice(0, cut + 1));
	const name = $derived(label ?? file.path.slice(cut + 1));
</script>

<!-- The menu hangs off the whole row, not just the name, so right-clicking the counts or the status
	letter works too. The row's button stays the keyboard path. -->
<li
	class="file-row"
	oncontextmenu={onmenu
		? (event) => {
				event.preventDefault();
				onmenu(event, file);
			}
		: undefined}
>
	<button
		class="open"
		style="padding-left:{indent}px"
		onclick={() => onopen(file.path)}
		use:tooltip={`${file.path} — click to open the diff`}
	>
		<FileIcon path={file.path} fallback="file" />
		<span class="path"
			>{#if dir}<span class="dir">{dir}</span>{/if}<span class="name">{name}</span></span
		>
	</button>
	{#if file.additions !== undefined || file.deletions !== undefined}
		<span class="counts">
			{#if file.additions}<span class="add">+{file.additions}</span>{/if}
			{#if file.deletions}<span class="del">−{file.deletions}</span>{/if}
		</span>
	{/if}
	<!-- Kept out of the name column: in tree view a leading letter pushes every file name off the
	     indent its folder sets, so the status sits in a column of its own on the right. -->
	<span class="st st-{file.status}">{file.status}</span>
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
</li>

<style>
	.file-row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		padding-right: var(--gg-space-2);
	}
	.file-row:hover {
		background: var(--vscode-list-hoverBackground);
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
		font-size: 0.9em;
	}
	.st-A,
	.st-\? {
		color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
	}
	.st-M {
		color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
	}
	.st-D {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
	}
	.st-U {
		color: var(--vscode-gitDecoration-conflictingResourceForeground, #e4676b);
	}
	.path {
		display: flex;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.dir {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.name {
		flex: none;
	}
	.counts {
		flex: none;
		display: flex;
		gap: var(--gg-space-1);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.8em;
	}
	.add {
		color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
	}
	.del {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
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
