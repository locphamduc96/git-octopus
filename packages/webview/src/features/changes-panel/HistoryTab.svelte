<script lang="ts">
	import type { FileHistoryEntry } from '@git-octopus/shared';
	import { formatCommitDate } from '../../lib/commitDate';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		path,
		listEntries,
		loading,
		truncated,
		error,
		activeHash,
		onopen,
		onreveal,
	}: {
		path: string;
		listEntries: FileHistoryEntry[];
		loading: boolean;
		truncated: boolean;
		error: string | null;
		activeHash: string | null;
		/** Open the file's diff at this commit. */
		onopen: (entry: FileHistoryEntry) => void;
		/** Select the commit in the graph. */
		onreveal: (hash: string) => void;
	} = $props();

	const MAP_STATUS_LABEL: Record<string, string> = {
		A: 'Added',
		M: 'Modified',
		D: 'Deleted',
		R: 'Renamed',
		C: 'Copied',
		T: 'Type changed',
	};
</script>

<div class="tab">
	<div class="meta">
		<span class="path" use:tooltip={path}>{path}</span>
		{#if !loading && error === null}
			<span class="count">{listEntries.length}{truncated ? '+' : ''} commits</span>
		{/if}
	</div>
	{#if loading}
		<p class="hint">Reading the history…</p>
	{:else if error !== null}
		<p class="hint error">{error}</p>
	{:else if listEntries.length === 0}
		<p class="hint">No commit changed this file.</p>
	{:else}
		<ul>
			{#each listEntries as entry (entry.hash)}
				<li class:active={entry.hash === activeHash}>
					<button class="open" onclick={() => onopen(entry)}>
						<span
							class="st st-{entry.status}"
							use:tooltip={entry.oldPath
								? `Renamed from ${entry.oldPath}`
								: (MAP_STATUS_LABEL[entry.status] ?? entry.status)}>{entry.status}</span
						>
						<span class="lines">
							<span class="subject">{entry.subject}</span>
							<span class="sub">
								<span class="mono">{entry.hash.slice(0, 7)}</span>
								· {entry.author.name} · {formatCommitDate(entry.authoredAt, 'dayTime')}
								{#if entry.path !== path}<span class="was" use:tooltip={entry.path}
										>· as {entry.path.split('/').pop()}</span
									>{/if}
							</span>
						</span>
					</button>
					<IconButton
						name="target"
						label="Show in graph"
						title="Select this commit in the graph"
						onclick={() => onreveal(entry.hash)}
					/>
				</li>
			{/each}
		</ul>
		{#if truncated}
			<p class="hint">Showing the newest {listEntries.length} commits.</p>
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
	.path {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}
	.count {
		flex: none;
		margin-left: auto;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--gg-space-3);
	}
	li {
		display: flex;
		align-items: center;
		padding-right: var(--gg-space-1);
	}
	li:hover {
		background: var(--vscode-list-hoverBackground);
	}
	li.active {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.open {
		display: flex;
		align-items: flex-start;
		gap: var(--gg-space-2);
		flex: 1;
		min-width: 0;
		padding: var(--gg-space-1) var(--gg-space-2);
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.lines {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.subject,
	.sub {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	li.active .sub {
		color: inherit;
		opacity: 0.8;
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.st {
		flex: none;
		width: 1.1em;
		text-align: center;
		font-weight: 600;
	}
	.st-A {
		color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
	}
	.st-M,
	.st-R,
	.st-C,
	.st-T {
		color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
	}
	.st-D {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
	}
	.hint {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
	.hint.error {
		color: var(--vscode-errorForeground);
	}
</style>
