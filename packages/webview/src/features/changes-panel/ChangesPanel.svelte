<script lang="ts">
	import type {
		CommitDetails,
		FileChange,
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import ChangesTab from './ChangesTab.svelte';
	import CommitTab from './CommitTab.svelte';
	import CompareTab from './CompareTab.svelte';

	export type PanelTab = 'changes' | 'commit' | 'compare';

	export interface ComparisonState {
		fromHash: string | null;
		toHash: string | null;
		files: FileChange[];
		loading: boolean;
	}

	let {
		tab,
		working,
		details,
		detailsLoading,
		branchName,
		ahead,
		comparison,
		ontab,
		onworkingAction,
		onopenWorkingFile,
		onopenDiff,
		onopenCompareDiff,
		onpush,
	}: {
		comparison: ComparisonState;
		onopenCompareDiff: (path: string) => void;
		tab: PanelTab;
		working: WorkingTreeStatus | null;
		details: CommitDetails | null;
		detailsLoading: boolean;
		branchName: string | null;
		ahead: number;
		onpush: () => void;
		ontab: (tab: PanelTab) => void;
		onworkingAction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenWorkingFile: (path: string) => void;
		onopenDiff: (path: string) => void;
	} = $props();

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);
</script>

<aside class="panel">
	<header>
		<span class="summary">
			{changeCount} file change{changeCount === 1 ? '' : 's'}
			{#if branchName}
				on <span class="branch">{branchName}</span>
			{/if}
		</span>
	</header>

	<nav class="tabs">
		<button class:active={tab === 'changes'} onclick={() => ontab('changes')}>
			Changes {#if changeCount > 0}<span class="badge">{changeCount}</span>{/if}
		</button>
		<button class:active={tab === 'commit'} onclick={() => ontab('commit')}>Commit</button>
		{#if comparison.fromHash}
			<button class:active={tab === 'compare'} onclick={() => ontab('compare')}>Compare</button>
		{/if}
	</nav>

	<div class="body">
		{#if tab === 'changes'}
			<ChangesTab
				{working}
				{ahead}
				{onpush}
				onaction={onworkingAction}
				onopenFile={onopenWorkingFile}
			/>
		{:else if tab === 'commit'}
			<CommitTab {details} loading={detailsLoading} {onopenDiff} />
		{:else}
			<CompareTab
				fromHash={comparison.fromHash}
				toHash={comparison.toHash}
				files={comparison.files}
				loading={comparison.loading}
				onopenDiff={onopenCompareDiff}
			/>
		{/if}
	</div>
</aside>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		min-width: 0;
		border-left: 1px solid var(--gg-border);
	}
	header {
		padding: var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		font-size: 0.9em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.branch {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border-radius: 3px;
		padding: 0 var(--gg-space-1);
	}
	.tabs {
		display: flex;
		border-bottom: 1px solid var(--gg-border);
	}
	.tabs button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--gg-fg-muted);
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-3);
	}
	.tabs button.active {
		color: var(--gg-fg);
		border-bottom-color: var(--gg-accent);
	}
	.badge {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border-radius: 8px;
		padding: 0 var(--gg-space-1);
		font-size: 0.85em;
	}
	.body {
		flex: 1;
		min-height: 0;
	}
</style>
