<script lang="ts">
	import type { CommitDetails } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';

	let {
		details,
		loading,
		onopenDiff,
	}: {
		details: CommitDetails | null;
		loading: boolean;
		onopenDiff: (path: string) => void;
	} = $props();
</script>

<div class="tab">
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if !details}
		<p class="hint">Select a commit to see its details.</p>
	{:else}
		<div class="meta">
			<span class="hash">{details.hash.slice(0, 10)}</span>
			<span class="count">{details.files.length} files</span>
		</div>
		{#if details.body}
			<pre class="body">{details.body}</pre>
		{/if}
		<ul>
			{#each details.files as file (file.path)}
				<FileRow {file} onopen={onopenDiff} />
			{/each}
		</ul>
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
	.hash {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.count {
		margin-left: auto;
	}
	.body {
		margin: 0;
		padding: var(--gg-space-3) var(--gg-space-2);
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
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
