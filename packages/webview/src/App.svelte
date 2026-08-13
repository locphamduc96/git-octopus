<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		Commit,
		CommitActionId,
		CommitDetails,
		GraphRow,
		HostToWebview,
		RepoInfo,
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import { UNCOMMITTED_HASH } from '@git-octopus/shared';
	import { layoutCommits } from '@git-octopus/graph-layout';
	import { onHostMessage, postToHost } from './lib/bridge';
	import ControlBar from './features/control-bar/ControlBar.svelte';
	import FindWidget from './features/find/FindWidget.svelte';
	import GraphView from './features/graph/GraphView.svelte';
	import ChangesPanel, { type PanelTab } from './features/changes-panel/ChangesPanel.svelte';
	import Splitter from './lib/ui/Splitter.svelte';

	type Status = 'loading' | 'ready' | 'error';
	const STACK_BREAKPOINT = 768;
	const COMMIT_LIMIT = 300;

	let status = $state<Status>('loading');
	let rows = $state<GraphRow[]>([]);
	let repoName = $state<string | null>(null);
	let errorMessage = $state('');
	let working = $state<WorkingTreeStatus | null>(null);

	let repos = $state<RepoInfo[]>([]);
	let activeRepo = $state<string | null>(null);
	let listBranches = $state<string[]>([]);
	let currentBranch = $state<string | null>(null);
	let branch = $state<string | null>(null);
	let showRemoteBranches = $state(true);
	let ahead = $state(0);
	let behind = $state(0);

	let findOpen = $state(false);
	let findQuery = $state('');

	let selectedHash = $state<string | null>(null);
	let details = $state<CommitDetails | null>(null);
	let detailsLoading = $state(false);
	let tab = $state<PanelTab>('changes');

	let shell = $state<HTMLDivElement | null>(null);
	let shellWidth = $state(1200);
	let shellHeight = $state(600);
	let panelRatio = $state(0.35);

	const stacked = $derived(shellWidth < STACK_BREAKPOINT);

	/** Rows shown in the graph: filtered by the find query when one is active. */
	const visibleRows = $derived.by(() => {
		const query = findQuery.trim().toLowerCase();
		if (!findOpen || query === '') return rows;
		return rows.filter((row) => {
			const commit = row.commit;
			return (
				commit.subject.toLowerCase().includes(query) ||
				commit.author.name.toLowerCase().includes(query) ||
				commit.hash.toLowerCase().startsWith(query)
			);
		});
	});

	function onKeydown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
			event.preventDefault();
			findOpen = true;
		}
	}

	function closeFind(): void {
		findOpen = false;
		findQuery = '';
	}

	onMount(() => {
		const off = onHostMessage((message: HostToWebview) => {
			if (message.type === 'commits') {
				rows = layoutCommits(message.commits);
				repoName = message.repoName;
				working = message.working;
				repos = message.repos;
				activeRepo = message.activeRepo;
				listBranches = message.listBranches;
				currentBranch = message.currentBranch;
				ahead = message.ahead;
				behind = message.behind;
				status = 'ready';
			} else if (message.type === 'commitDetails') {
				details = message.details;
				detailsLoading = false;
			} else if (message.type === 'error') {
				errorMessage = message.message;
				repos = message.repos;
				activeRepo = message.activeRepo;
				status = 'error';
				detailsLoading = false;
			}
		});
		postToHost({ type: 'ready' });
		return off;
	});

	function load(): void {
		status = 'loading';
		postToHost({
			type: 'loadCommits',
			limit: COMMIT_LIMIT,
			filters: { branch, showRemoteBranches },
		});
	}

	function selectRepo(path: string): void {
		status = 'loading';
		branch = null;
		selectedHash = null;
		details = null;
		postToHost({ type: 'selectRepo', path });
	}

	function selectBranch(next: string | null): void {
		branch = next;
		load();
	}

	function toggleRemote(show: boolean): void {
		showRemoteBranches = show;
		load();
	}

	function select(hash: string): void {
		selectedHash = hash;
		if (hash === UNCOMMITTED_HASH) {
			tab = 'changes';
			return;
		}
		tab = 'commit';
		details = null;
		detailsLoading = true;
		postToHost({ type: 'loadCommitDetails', hash });
	}

	function openDiff(path: string): void {
		if (selectedHash) postToHost({ type: 'openDiff', hash: selectedHash, path });
	}

	function openWorkingFile(path: string): void {
		postToHost({ type: 'openWorkingDiff', path });
	}

	function workingAction(action: WorkingTreeAction, path?: string, message?: string): void {
		postToHost({ type: 'workingTreeAction', action, path, message });
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

	function resizePanel(clientPos: number): void {
		if (!shell) return;
		const box = shell.getBoundingClientRect();
		const ratio = stacked
			? 1 - (clientPos - box.top) / box.height
			: 1 - (clientPos - box.left) / box.width;
		panelRatio = Math.min(0.75, Math.max(0.15, ratio));
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
	<header class="topbar">
		<span class="title">🐙 {repoName ?? 'Git Octopus'}</span>
		{#if status === 'ready'}
			<span class="count">{rows.length} commits</span>
		{/if}
	</header>

	<ControlBar
		{repos}
		{activeRepo}
		{listBranches}
		{branch}
		{showRemoteBranches}
		{behind}
		onselectRepo={selectRepo}
		onselectBranch={selectBranch}
		ontoggleRemote={toggleRemote}
		onrefresh={load}
		onterminal={() => postToHost({ type: 'openTerminal' })}
		onfind={() => (findOpen = true)}
		onfetch={() => postToHost({ type: 'repoAction', action: 'fetch' })}
	/>

	{#if findOpen}
		<FindWidget
			query={findQuery}
			matchCount={visibleRows.length}
			onquery={(next) => (findQuery = next)}
			onclose={closeFind}
		/>
	{/if}

	<div
		class="shell"
		class:stacked
		bind:this={shell}
		bind:clientWidth={shellWidth}
		bind:clientHeight={shellHeight}
	>
		<div class="graph-area">
			{#if status === 'loading'}
				<p class="hint">Loading…</p>
			{:else if status === 'error'}
				<p class="error">{errorMessage}</p>
			{:else if visibleRows.length === 0}
				<p class="hint">{findQuery ? 'No matching commits.' : 'No commits found.'}</p>
			{:else}
				<GraphView
					rows={visibleRows}
					{selectedHash}
					{currentBranch}
					onselect={select}
					onaction={runAction}
				/>
			{/if}
		</div>

		<Splitter vertical={stacked} onresize={resizePanel} />

		<div
			class="panel-area"
			style={stacked
				? `height:${Math.round(shellHeight * panelRatio)}px`
				: `width:${Math.round(shellWidth * panelRatio)}px`}
		>
			<ChangesPanel
				{tab}
				{working}
				{details}
				{detailsLoading}
				branchName={currentBranch}
				{ahead}
				onpush={() => postToHost({ type: 'repoAction', action: 'push' })}
				ontab={(next) => (tab = next)}
				onworkingAction={workingAction}
				onopenWorkingFile={openWorkingFile}
				onopenDiff={openDiff}
			/>
		</div>
	</div>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		padding: var(--gg-space-1) var(--gg-space-3);
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
	.shell {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.shell.stacked {
		flex-direction: column;
	}
	.graph-area {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.panel-area {
		flex: none;
		min-width: 0;
		min-height: 0;
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
