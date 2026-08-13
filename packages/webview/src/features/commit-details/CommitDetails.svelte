<script lang="ts">
	import type { CommitDetails, FileStatus } from '@git-octopus/shared';

	let {
		details,
		loading,
		onopenDiff,
		onclose,
	}: {
		details: CommitDetails | null;
		loading: boolean;
		onopenDiff: (path: string) => void;
		onclose: () => void;
	} = $props();

	const mapStatusLabel: Record<FileStatus, string> = {
		A: 'A',
		M: 'M',
		D: 'D',
		R: 'R',
		C: 'C',
		T: 'T',
		U: 'U',
		X: '?',
	};
</script>

<section class="details">
	<header>
		<span class="hash">{details ? details.hash.slice(0, 10) : ''}</span>
		<button class="close" onclick={onclose} title="Close">✕</button>
	</header>
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if details}
		{#if details.body}
			<pre class="body">{details.body}</pre>
		{/if}
		<ul class="files">
			{#each details.files as file (file.path)}
				<li>
					<button class="file" onclick={() => onopenDiff(file.path)} title="Open diff">
						<span class="st st-{file.status}">{mapStatusLabel[file.status]}</span>
						<span class="path">{file.path}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.details {
		border-top: 1px solid var(--gg-border);
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: auto;
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: var(--gg-space-1) var(--gg-space-3);
		position: sticky;
		top: 0;
		background: var(--gg-bg);
		border-bottom: 1px solid var(--gg-border);
	}
	.hash {
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--gg-fg-muted);
	}
	.close {
		margin-left: auto;
		background: transparent;
		border: none;
		color: var(--gg-fg-muted);
		cursor: pointer;
	}
	.body {
		margin: 0;
		padding: var(--gg-space-3);
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
	}
	.files {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--gg-space-3);
	}
	.file {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
		padding: 2px var(--gg-space-3);
	}
	.file:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.st {
		flex: none;
		width: 1.2em;
		text-align: center;
		font-weight: 600;
	}
	.st-A {
		color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
	}
	.st-M {
		color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
	}
	.st-D {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
	}
	.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
</style>
