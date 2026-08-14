<script lang="ts">
	import type {
		CommitDetails,
		FileChange,
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import ChangesTab from './ChangesTab.svelte';
	import CommitTab, { type FileViewMode } from './CommitTab.svelte';
	import CompareTab from './CompareTab.svelte';
	import Icon from '../../lib/ui/Icon.svelte';

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
		behind,
		comparison,
		onworkingAction,
		onopenWorkingFile,
		onopenDiff,
		onopenCompareDiff,
		onpush,
		onpushForce,
		oncopy,
		onselectCommit,
		fileView,
		onfileView,
		onclose,
	}: {
		fileView: FileViewMode;
		onfileView: (mode: FileViewMode) => void;
		onclose: () => void;
		mode: PanelMode;
		working: WorkingTreeStatus | null;
		details: CommitDetails | null;
		detailsLoading: boolean;
		branchName: string | null;
		ahead: number;
		behind: number;
		comparison: ComparisonState;
		onworkingAction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenWorkingFile: (path: string) => void;
		onopenDiff: (path: string) => void;
		onopenCompareDiff: (path: string) => void;
		onpush: () => void;
		onpushForce: () => void;
		oncopy: (text: string) => void;
		onselectCommit: (hash: string) => void;
	} = $props();

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);
</script>

<aside class="panel">
	<header>
		{#if mode === 'changes'}
			<span class="summary">
				{#if branchName}
					<span class="branch" title="Commits and pushes go to this branch">{branchName}</span>
				{:else}
					<span class="branch" title="HEAD is detached">detached</span>
				{/if}
				{#if ahead > 0}<span class="sync" title="{ahead} commit(s) to push">↑{ahead}</span>{/if}
				{#if behind > 0}<span class="sync" title="{behind} commit(s) to pull">↓{behind}</span>{/if}
				{#if changeCount > 0}
					· {changeCount} change{changeCount === 1 ? '' : 's'}
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

		{#if mode !== 'changes'}
			<span class="tools">
				<button
					class:active={fileView === 'list'}
					onclick={() => onfileView('list')}
					title="File list — show every changed file with its full path"
				>
					<Icon name="list-flat" label="File list" />
				</button>
				<button
					class:active={fileView === 'tree'}
					onclick={() => onfileView('tree')}
					title="File tree — group changed files into folders"
				>
					<Icon name="list-tree" label="File tree" />
				</button>
				<button onclick={onclose} title="Close — go back to the working tree">
					<Icon name="close" label="Close" />
				</button>
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
			<CommitTab
				{details}
				loading={detailsLoading}
				{fileView}
				{onopenDiff}
				{oncopy}
				{onselectCommit}
			/>
		{:else}
			<CompareTab
				fromHash={comparison.fromHash}
				toHash={comparison.toHash}
				files={comparison.files}
				loading={comparison.loading}
				{fileView}
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
	.sync {
		color: var(--gg-accent);
		margin-left: var(--gg-space-1);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 1px;
		margin-left: auto;
		flex: none;
	}
	.tools button {
		display: inline-flex;
		align-items: center;
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		padding: 3px 4px;
	}
	.tools button:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.tools button.active {
		background: var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground));
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.body {
		flex: 1;
		min-height: 0;
	}
</style>
