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

	/** What the panel shows, derived from the graph selection rather than a tab strip. */
	export type PanelMode = 'changes' | 'commit' | 'compare';

	export interface ComparisonState {
		fromHash: string | null;
		toHash: string | null;
		files: FileChange[];
		loading: boolean;
	}

	let {
		mode,
		working,
		details,
		detailsLoading,
		branchName,
		ahead,
		comparison,
		onworkingAction,
		onopenWorkingFile,
		onopenDiff,
		onopenCompareDiff,
		onpush,
		onpushForce,
	}: {
		mode: PanelMode;
		working: WorkingTreeStatus | null;
		details: CommitDetails | null;
		detailsLoading: boolean;
		branchName: string | null;
		ahead: number;
		comparison: ComparisonState;
		onworkingAction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenWorkingFile: (path: string) => void;
		onopenDiff: (path: string) => void;
		onopenCompareDiff: (path: string) => void;
		onpush: () => void;
		onpushForce: () => void;
	} = $props();

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);
</script>

<aside class="panel">
	<header>
		{#if mode === 'changes'}
			<span class="summary">
				{changeCount} file change{changeCount === 1 ? '' : 's'}
				{#if branchName}
					on <span class="branch">{branchName}</span>
				{/if}
			</span>
		{:else if mode === 'commit'}
			<span class="summary">
				Commit
				{#if details}<span class="mono">{details.hash.slice(0, 8)}</span>{/if}
			</span>
		{:else}
			<span class="summary">
				Comparing
				{#if comparison.fromHash && comparison.toHash}
					<span class="mono">
						{comparison.fromHash.slice(0, 8)} ↔ {comparison.toHash.slice(0, 8)}
					</span>
				{/if}
			</span>
		{/if}
	</header>

	<div class="body">
		{#if mode === 'changes'}
			<ChangesTab
				{working}
				{ahead}
				{onpush}
				{onpushForce}
				onaction={onworkingAction}
				onopenFile={onopenWorkingFile}
			/>
		{:else if mode === 'commit'}
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
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		height: var(--gg-header-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		color: var(--gg-fg-muted);
		white-space: nowrap;
		overflow: hidden;
	}
	.summary {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.branch {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border-radius: 3px;
		padding: 0 var(--gg-space-1);
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.body {
		flex: 1;
		min-height: 0;
	}
</style>
