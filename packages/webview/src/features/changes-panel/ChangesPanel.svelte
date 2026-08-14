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
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import type { FileViewMode } from '../../lib/fileTree';
	import { buildFileMenu, type FileMenuAction } from '../../lib/fileMenu';
	import { tooltip } from '../../lib/ui/tooltip';

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
		onopenFile,
		oncopyPath,
		onpush,
		onpushForce,
		oncopy,
		onselectCommit,
		fileView,
		onfileView,
		onclose,
		metaOpen,
		onmetaOpen,
	}: {
		fileView: FileViewMode;
		onfileView: (mode: FileViewMode) => void;
		onclose: () => void;
		metaOpen: boolean;
		onmetaOpen: (open: boolean) => void;
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
		/** Open the file itself: the copy on disk, or its content at `hash`. */
		onopenFile: (path: string, hash?: string) => void;
		oncopyPath: (path: string, absolute: boolean) => void;
		onpush: () => void;
		onpushForce: () => void;
		oncopy: (text: string) => void;
		onselectCommit: (hash: string) => void;
	} = $props();

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);

	/**
	 * One menu for all three tabs. Each tab hands over the file plus whatever actions its own section
	 * offers, so the panel does not have to work out which list a row came from.
	 */
	let menu = $state<{ x: number; y: number; file: FileChange; listActions: FileMenuAction[] } | null>(
		null
	);

	function openMenu(event: MouseEvent, file: FileChange, listActions: FileMenuAction[] = []): void {
		menu = { x: event.clientX, y: event.clientY, file, listActions };
	}

	/** The diff a file opens to depends on what the panel is showing. */
	function openChanges(path: string): void {
		if (mode === 'changes') onopenWorkingFile(path);
		else if (mode === 'commit') onopenDiff(path);
		else onopenCompareDiff(path);
	}

	function runMenu(id: string): void {
		const file = menu?.file;
		menu = null;
		if (!file) return;
		switch (id) {
			case 'openChanges':
				return openChanges(file.path);
			case 'openFile':
				return onopenFile(file.path);
			case 'openFileAtRev':
				return onopenFile(file.path, details?.hash);
			case 'copyPath':
				return oncopyPath(file.path, true);
			case 'copyRelativePath':
				return oncopyPath(file.path, false);
			default:
				return onworkingAction(id as WorkingTreeAction, file.path);
		}
	}
</script>

<aside class="panel">
	<header>
		{#if mode === 'changes'}
			<span class="summary">
				{#if branchName}
					<span class="branch" use:tooltip={'Commits and pushes go to this branch'}>{branchName}</span>
				{:else}
					<span class="branch" use:tooltip={'HEAD is detached'}>detached</span>
				{/if}
				{#if ahead > 0}<span class="sync" use:tooltip={`${ahead} commit${ahead === 1 ? '' : 's'} waiting to be pushed`}>↑{ahead}</span>{/if}
				{#if behind > 0}<span class="sync" use:tooltip={`${behind} commit${behind === 1 ? '' : 's'} waiting to be pulled`}>↓{behind}</span>{/if}
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

		<span class="tools">
			<button
				class:active={fileView === 'list'}
				onclick={() => onfileView('list')}
				use:tooltip={'File list — show every changed file with its full path'}
			>
				<Icon name="list-flat" label="File list" />
			</button>
			<button
				class:active={fileView === 'tree'}
				onclick={() => onfileView('tree')}
				use:tooltip={'File tree — group changed files into folders'}
			>
				<Icon name="list-tree" label="File tree" />
			</button>
			<!-- The working tree is where the panel returns to, so it has nothing to close. -->
			{#if mode !== 'changes'}
				<button onclick={onclose} use:tooltip={'Close — go back to the working tree'}>
					<Icon name="close" label="Close" />
				</button>
			{/if}
		</span>
	</header>

	<div class="body">
		{#if mode === 'changes'}
			<ChangesTab
				{working}
				{ahead}
				{fileView}
				{onpush}
				{onpushForce}
				onaction={onworkingAction}
				onopenFile={onopenWorkingFile}
				onmenu={openMenu}
			/>
		{:else if mode === 'commit'}
			<CommitTab
				{details}
				loading={detailsLoading}
				{fileView}
				{metaOpen}
				{onmetaOpen}
				{onopenDiff}
				{oncopy}
				{onselectCommit}
				onmenu={(event, file) => openMenu(event, file)}
			/>
		{:else}
			<CompareTab
				fromHash={comparison.fromHash}
				toHash={comparison.toHash}
				files={comparison.files}
				loading={comparison.loading}
				{fileView}
				onopenDiff={onopenCompareDiff}
				onmenu={(event, file) => openMenu(event, file)}
			/>
		{/if}
	</div>
</aside>

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		items={buildFileMenu({
			listActions: menu.listActions,
			atRevision: mode === 'commit' && details !== null,
			deleted: menu.file.status === 'D',
		})}
		onselect={runMenu}
		onclose={() => (menu = null)}
	/>
{/if}

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
	/* Outlined like the chips on the graph, so the same idea looks the same everywhere. */
	.branch {
		border: 1px solid var(--gg-fg-muted);
		color: var(--gg-fg);
		border-radius: var(--gg-chip-radius);
		padding: var(--gg-chip-padding);
		font-weight: 600;
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
