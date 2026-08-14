<script lang="ts">
	import type { FileChange, WorkingTreeAction, WorkingTreeStatus } from '@git-octopus/shared';
	import FileRow, { type FileRowAction } from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import ConfirmDialog from '../../lib/ui/ConfirmDialog.svelte';
	import CommitDialog from './CommitDialog.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		working,
		ahead,
		fileView,
		onaction,
		onopenFile,
		onpush,
		onpushForce,
	}: {
		working: WorkingTreeStatus | null;
		ahead: number;
		fileView: FileViewMode;
		onaction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenFile: (path: string) => void;
		onpush: () => void;
		onpushForce: () => void;
	} = $props();

	type Dialog = 'commit' | 'push' | 'forcePush' | 'undo';

	let dialog = $state<Dialog | null>(null);

	const changes = $derived(working ? working.unstaged.filter((f) => f.status !== '?') : []);
	const untracked = $derived(working ? working.unstaged.filter((f) => f.status === '?') : []);
	const staged = $derived<FileChange[]>(working ? working.staged : []);

	const stageActions = [
		{ id: 'discard', label: 'Discard changes to this file — cannot be undone', icon: 'discard' },
		{ id: 'stage', label: 'Stage this file for the next commit', icon: 'add' },
	];
	const unstageActions = [
		{ id: 'unstage', label: 'Unstage this file — keep the change, drop it from the commit', icon: 'remove' },
	];

	function commit(message: string): void {
		dialog = null;
		onaction('commit', undefined, message);
	}
</script>

<div class="tab">
	<div class="toolbar">
		<button
			class="push"
			onclick={() => (dialog = 'push')}
			oncontextmenu={(event) => {
				event.preventDefault();
				dialog = 'forcePush';
			}}
			disabled={ahead === 0}
			use:tooltip={ahead > 0
				? `Push ${ahead} commit${ahead === 1 ? '' : 's'} to the remote — right-click to force push (with lease)`
				: 'Push — nothing to push, the remote is up to date'}
		>
			<Icon name="arrow-up" />
			Push{ahead > 0 ? ` ${ahead}` : ''}
		</button>
		<button
			onclick={() => (dialog = 'undo')}
			use:tooltip={'Undo last commit — put its changes back as staged, keeping your work'}
		>
			<Icon name="discard" label="Undo last commit" />
		</button>
		<button
			onclick={() => onaction('stash')}
			use:tooltip={'Stash — save all uncommitted changes aside and clean the working tree'}
			disabled={changes.length + untracked.length + staged.length === 0}
		>
			<Icon name="archive" label="Stash uncommitted changes" />
		</button>
		<button
			onclick={() => onaction('unstageAll')}
			use:tooltip={'Unstage all — move every staged file back out of the next commit'}
		>
			<Icon name="remove" label="Unstage all" />
		</button>
		<button
			onclick={() => onaction('stageAll')}
			use:tooltip={'Stage all — include every changed and untracked file in the next commit'}
		>
			<Icon name="add" label="Stage all" />
		</button>
		<button
			class="primary"
			onclick={() => (dialog = 'commit')}
			disabled={staged.length === 0}
			use:tooltip={staged.length === 0
				? 'Commit — stage at least one file first'
				: `Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}`}
		>
			Commit
		</button>
	</div>

	<div class="sections">
		{@render section('Changes', changes, stageActions)}
		{@render section('Untracked', untracked, stageActions)}
		{@render section('Staged Changes', staged, unstageActions)}
	</div>
</div>

{#snippet section(title: string, listFiles: FileChange[], actions: FileRowAction[])}
	<section>
		<h3>{title} <span class="count">{listFiles.length}</span></h3>
		{#if listFiles.length === 0}
			<p class="empty">No files</p>
		{:else if fileView === 'tree'}
			<FileTree
				nodes={buildFileTree(listFiles)}
				{actions}
				onopen={onopenFile}
				onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
			/>
		{:else}
			<ul>
				{#each listFiles as file (file.path)}
					<FileRow
						{file}
						{actions}
						onopen={onopenFile}
						onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
					/>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#if dialog === 'commit'}
	<CommitDialog
		stagedCount={staged.length}
		oncommit={commit}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'push'}
	<ConfirmDialog
		title="Push to remote"
		message="Push {ahead} commit{ahead === 1 ? '' : 's'} to the remote?"
		onconfirm={() => {
			dialog = null;
			onpush();
		}}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'forcePush'}
	<ConfirmDialog
		title="Force push"
		message="Force push (with lease) rewrites the remote branch. Anyone who already pulled it will have to reconcile their history. Continue?"
		confirmLabel="Force push"
		danger
		onconfirm={() => {
			dialog = null;
			onpushForce();
		}}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'undo'}
	<ConfirmDialog
		title="Undo last commit"
		message="The last commit will be removed and its changes put back as staged, so nothing is lost. Avoid this if the commit is already pushed."
		confirmLabel="Undo commit"
		onconfirm={() => {
			dialog = null;
			onaction('undoCommit');
		}}
		oncancel={() => (dialog = null)}
	/>
{/if}

<style>
	.tab {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 1px;
		height: var(--gg-header-h);
		box-sizing: border-box;
		flex: none;
		padding: 0 var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		padding: 3px 5px;
	}
	.toolbar button:hover:not(:disabled) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.toolbar button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.toolbar .push {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
	}
	.toolbar .push:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.toolbar .primary {
		margin-left: auto;
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	.toolbar .primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.sections {
		flex: 1;
		overflow: auto;
		min-height: 0;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
		padding: var(--gg-space-1) var(--gg-space-2);
		font-size: 0.85em;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--gg-fg-muted);
	}
	.count {
		margin-left: auto;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.empty {
		margin: 0;
		padding: 2px var(--gg-space-3);
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
</style>
