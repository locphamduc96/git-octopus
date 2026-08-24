<script lang="ts">
	import type { FileChange, WorkingTreeAction, WorkingTreeStatus } from '@git-octopus/shared';
	import FileRow, { type FileRowAction } from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import ConfirmDialog from '../../lib/ui/ConfirmDialog.svelte';
	import CommitDialog from './CommitDialog.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';
	import type { FileMenuAction } from '../../lib/fileMenu';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		working,
		ahead,
		fileView,
		activePath,
		onaction,
		onopenFile,
		onmenu,
		onpush,
		onpushForce,
	}: {
		working: WorkingTreeStatus | null;
		ahead: number;
		fileView: FileViewMode;
		activePath: string | null;
		/** Right-click on a file; the section's own actions ride along into the menu. */
		onmenu: (event: MouseEvent, file: FileChange, listActions: FileMenuAction[]) => void;
		onaction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenFile: (path: string) => void;
		onpush: () => void;
		onpushForce: () => void;
	} = $props();

	type Dialog = 'commit' | 'push' | 'forcePush' | 'undo';

	let dialog = $state<Dialog | null>(null);

	const conflicts = $derived(working ? working.unstaged.filter((f) => f.status === 'U') : []);
	const changes = $derived(
		working ? working.unstaged.filter((f) => f.status !== '?' && f.status !== 'U') : []
	);
	const untracked = $derived(working ? working.unstaged.filter((f) => f.status === '?') : []);
	const staged = $derived<FileChange[]>(working ? working.staged : []);

	const stageActions = [
		{ id: 'discard', label: 'Discard changes to this file — cannot be undone', icon: 'discard' },
		{ id: 'stage', label: 'Stage this file for the next commit', icon: 'add' },
	];
	const unstageActions = [
		{
			id: 'unstage',
			label: 'Unstage this file — keep the change, drop it from the commit',
			icon: 'remove',
		},
	];
	// The hover buttons carry a full explanation as their tooltip; a menu row needs a short label.
	const stageMenu = [
		{ id: 'stage', label: 'Stage' },
		{ id: 'discard', label: 'Discard Changes' },
	];
	const unstageMenu = [{ id: 'unstage', label: 'Unstage' }];

	function commit(message: string, amend: boolean): void {
		dialog = null;
		onaction(amend ? 'amend' : 'commit', undefined, message);
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
		<IconButton
			name="discard"
			label="Undo last commit"
			title="Undo last commit — put its changes back as staged, keeping your work"
			onclick={() => (dialog = 'undo')}
		/>
		<IconButton
			name="archive"
			label="Stash uncommitted changes"
			title="Stash — save all uncommitted changes aside and clean the working tree"
			disabled={changes.length + untracked.length + staged.length === 0}
			onclick={() => onaction('stash')}
		/>
		<IconButton
			name="remove"
			label="Unstage all"
			title="Unstage all — move every staged file back out of the next commit"
			onclick={() => onaction('unstageAll')}
		/>
		<IconButton
			name="add"
			label="Stage all"
			title="Stage all — include every changed and untracked file in the next commit"
			onclick={() => onaction('stageAll')}
		/>
		<span class="ai">
			<IconButton
				name="wand"
				label="AI commit"
				title={changes.length + untracked.length + staged.length + conflicts.length === 0
					? 'AI commit — nothing has changed yet'
					: 'AI commit — let an agent CLI draft the message, or a split into several commits'}
				disabled={changes.length + untracked.length + staged.length + conflicts.length === 0}
				onclick={() => aiCommit.openDialog()}
			/>
		</span>
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
		{#if conflicts.length > 0}
			{@render section('Conflicts', conflicts, stageActions, stageMenu)}
		{/if}
		{@render section('Changes', changes, stageActions, stageMenu)}
		{@render section('Untracked', untracked, stageActions, stageMenu)}
		{@render section('Staged Changes', staged, unstageActions, unstageMenu)}
	</div>
</div>

{#snippet section(
	title: string,
	listFiles: FileChange[],
	actions: FileRowAction[],
	listMenuActions: FileMenuAction[]
)}
	<section>
		<h3>{title} <span class="count">{listFiles.length}</span></h3>
		{#if listFiles.length === 0}
			<p class="empty">No files</p>
		{:else if fileView === 'tree'}
			<FileTree
				nodes={buildFileTree(listFiles)}
				{activePath}
				{actions}
				onopen={onopenFile}
				onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
				onmenu={(event, file) => onmenu(event, file, listMenuActions)}
			/>
		{:else}
			<ul>
				{#each listFiles as file (file.path)}
					<FileRow
						{file}
						active={file.path === activePath}
						{actions}
						onopen={onopenFile}
						onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
						onmenu={(event) => onmenu(event, file, listMenuActions)}
					/>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#if dialog === 'commit'}
	<CommitDialog stagedCount={staged.length} oncommit={commit} oncancel={() => (dialog = null)} />
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
	/* The labelled buttons; the icon-only ones are `IconButton` and bring their own square. */
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: var(--gg-hit);
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		padding: 0 5px;
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
	/* The right-hand cluster: the wand carries the auto margin, Commit rides beside it. */
	.toolbar .ai {
		margin-left: auto;
		display: inline-flex;
	}
	.toolbar .primary {
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
