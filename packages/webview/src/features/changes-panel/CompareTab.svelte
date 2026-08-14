<script lang="ts">
	import type { FileChange } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';

	let {
		fromHash,
		toHash,
		files,
		loading,
		fileView,
		onopenDiff,
	}: {
		fromHash: string | null;
		toHash: string | null;
		files: FileChange[];
		loading: boolean;
		fileView: FileViewMode;
		onopenDiff: (path: string) => void;
	} = $props();

	const tree = $derived(buildFileTree(files));
</script>

<div class="tab">
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if !fromHash || !toHash}
		<p class="hint">Ctrl/Cmd + click a second commit to compare.</p>
	{:else}
		<div class="meta">
			<span class="mono">{fromHash.slice(0, 8)} ↔ {toHash.slice(0, 8)}</span>
			<span class="count">{files.length} files</span>
		</div>
		{#if files.length === 0}
			<p class="hint">No differences.</p>
		{:else if fileView === 'tree'}
			<FileTree nodes={tree} onopen={onopenDiff} />
		{:else}
			<ul>
				{#each files as file (file.path)}
					<FileRow {file} onopen={onopenDiff} />
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.tab {
		height: 100%;
		overflow: auto;
		min-height: 0;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.count {
		margin-left: auto;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--gg-space-3);
	}
	.hint {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
</style>
