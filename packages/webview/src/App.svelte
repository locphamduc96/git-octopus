<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		Commit,
		CommitActionId,
		CommitDetails,
		GraphRow,
		HostToWebview,
	} from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost } from './lib/bridge';
	import GraphView from './features/graph/GraphView.svelte';
	import CommitDetailsView from './features/commit-details/CommitDetails.svelte';

	type Status = 'loading' | 'ready' | 'error';

	let status = $state<Status>('loading');
	let rows = $state<GraphRow[]>([]);
	let repoName = $state<string | null>(null);
	let errorMessage = $state('');

	let selectedHash = $state<string | null>(null);
	let details = $state<CommitDetails | null>(null);
	let detailsLoading = $state(false);

	onMount(() => {
		const off = onHostMessage((message: HostToWebview) => {
			if (message.type === 'commits') {
				rows = layoutCommits(message.commits);
				repoName = message.repoName;
				status = 'ready';
			} else if (message.type === 'commitDetails') {
				details = message.details;
				detailsLoading = false;
			} else if (message.type === 'error') {
				errorMessage = message.message;
				status = 'error';
				detailsLoading = false;
			}
		});
		postToHost({ type: 'ready' });
		return off;
	});

	function refresh(): void {
		status = 'loading';
		selectedHash = null;
		details = null;
		postToHost({ type: 'loadCommits', limit: 300 });
	}

	function select(hash: string): void {
		selectedHash = hash;
		details = null;
		detailsLoading = true;
		postToHost({ type: 'loadCommitDetails', hash });
	}

	function closeDetails(): void {
		selectedHash = null;
		details = null;
	}

	function openDiff(path: string): void {
		if (selectedHash) postToHost({ type: 'openDiff', hash: selectedHash, path });
	}

	function runAction(action: CommitActionId, commit: Commit): void {
		postToHost({
			type: 'commitAction',
			action,
			hash: commit.hash,
			subject: commit.subject,
			branches: commit.refs
				.filter((ref) => ref.kind === 'branch' && !ref.remote)
				.map((ref) => (ref.kind === 'branch' ? ref.name : '')),
		});
	}
</script>

<div class="app">
	<header>
		<span class="title">🐙 {repoName ?? 'Git Octopus'}</span>
		{#if status === 'ready'}
			<span class="count">{rows.length} commits</span>
		{/if}
		<button onclick={refresh} title="Refresh">⟳</button>
	</header>

	<div class="layout">
		<div class="graph-area">
			{#if status === 'loading'}
				<p class="hint">Loading…</p>
			{:else if status === 'error'}
				<p class="error">{errorMessage}</p>
			{:else if rows.length === 0}
				<p class="hint">No commits found.</p>
			{:else}
				<GraphView {rows} {selectedHash} onselect={select} onaction={runAction} />
			{/if}
		</div>

		{#if selectedHash}
			<div class="details-area">
				<CommitDetailsView
					{details}
					loading={detailsLoading}
					onopenDiff={openDiff}
					onclose={closeDetails}
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		padding: var(--gg-space-2) var(--gg-space-3);
		border-bottom: 1px solid var(--gg-border);
		flex: none;
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
	.layout {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.graph-area {
		flex: 1;
		min-height: 0;
	}
	.details-area {
		flex: none;
		height: 40%;
		min-height: 120px;
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
