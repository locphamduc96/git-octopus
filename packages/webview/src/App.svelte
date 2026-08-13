<script lang="ts">
	import { onMount } from 'svelte';
	import type { GraphRow, HostToWebview } from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost } from './lib/bridge';
	import GraphView from './features/graph/GraphView.svelte';

	type Status = 'loading' | 'ready' | 'error';

	let status = $state<Status>('loading');
	let rows = $state<GraphRow[]>([]);
	let repoName = $state<string | null>(null);
	let errorMessage = $state('');

	onMount(() => {
		const off = onHostMessage((message: HostToWebview) => {
			if (message.type === 'commits') {
				rows = layoutCommits(message.commits);
				repoName = message.repoName;
				status = 'ready';
			} else if (message.type === 'error') {
				errorMessage = message.message;
				status = 'error';
			}
		});
		postToHost({ type: 'ready' });
		return off;
	});

	function refresh(): void {
		status = 'loading';
		postToHost({ type: 'loadCommits', limit: 300 });
	}
</script>

<header>
	<span class="title">🐙 {repoName ?? 'Git Octopus'}</span>
	{#if status === 'ready'}
		<span class="count">{rows.length} commits</span>
	{/if}
	<button onclick={refresh} title="Refresh">⟳</button>
</header>

<main>
	{#if status === 'loading'}
		<p class="hint">Loading…</p>
	{:else if status === 'error'}
		<p class="error">{errorMessage}</p>
	{:else if rows.length === 0}
		<p class="hint">No commits found.</p>
	{:else}
		<GraphView {rows} />
	{/if}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		padding: var(--gg-space-2) var(--gg-space-3);
		border-bottom: 1px solid var(--gg-border);
		position: sticky;
		top: 0;
		background: var(--gg-bg);
	}
	.title {
		font-weight: 600;
	}
	.count {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	header button {
		margin-left: auto;
		background: transparent;
		color: var(--gg-fg);
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		cursor: pointer;
		padding: 0 var(--gg-space-2);
	}
	header button:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}
	main {
		padding: var(--gg-space-2) 0;
	}
	.hint,
	.error {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
	.error {
		color: var(--vscode-errorForeground);
	}
</style>
