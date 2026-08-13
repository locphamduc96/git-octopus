<script lang="ts">
	import type { FileChange, WorkingTreeAction, WorkingTreeStatus } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';
	import Icon from '../../lib/ui/Icon.svelte';

	let {
		working,
		ahead,
		onaction,
		onopenFile,
		onpush,
		onpushForce,
	}: {
		working: WorkingTreeStatus | null;
		ahead: number;
		onaction: (action: WorkingTreeAction, path?: string, message?: string) => void;
		onopenFile: (path: string) => void;
		onpush: () => void;
		onpushForce: () => void;
	} = $props();

	let commitMessage = $state('');

	const changes = $derived(working ? working.unstaged.filter((f) => f.status !== '?') : []);
	const untracked = $derived(working ? working.unstaged.filter((f) => f.status === '?') : []);
	const staged = $derived<FileChange[]>(working ? working.staged : []);

	const stageActions = [
		{ id: 'discard', label: 'Discard changes', icon: 'discard' },
		{ id: 'stage', label: 'Stage', icon: 'add' },
	];
	const unstageActions = [{ id: 'unstage', label: 'Unstage', icon: 'remove' }];

	function commit(): void {
		onaction('commit', undefined, commitMessage);
		commitMessage = '';
	}
</script>

<div class="tab">
	<div class="toolbar">
		<button
			class="push"
			onclick={onpush}
			oncontextmenu={(event) => {
				event.preventDefault();
				onpushForce();
			}}
			disabled={ahead === 0}
			title="Push to remote (right-click to force push)"
		>
			<Icon name="arrow-up" />
			Push{ahead > 0 ? ` ${ahead}` : ''}
		</button>
		<button
			onclick={() => onaction('stash')}
			title="Stash uncommitted changes"
			disabled={changes.length + untracked.length + staged.length === 0}
		>
			<Icon name="archive" label="Stash uncommitted changes" />
		</button>
		<button onclick={() => onaction('unstageAll')} title="Unstage all">
			<Icon name="remove" label="Unstage all" />
		</button>
		<button onclick={() => onaction('stageAll')} title="Stage all">
			<Icon name="add" label="Stage all" />
		</button>
		<button class="primary" onclick={commit} disabled={staged.length === 0}>Commit</button>
	</div>

	<textarea
		class="message"
		bind:value={commitMessage}
		placeholder="Commit message"
		rows="2"
	></textarea>

	<div class="sections">
		<section>
			<h3>Changes <span class="count">{changes.length}</span></h3>
			{#if changes.length === 0}
				<p class="empty">No files</p>
			{:else}
				<ul>
					{#each changes as file (file.path)}
						<FileRow
							{file}
							actions={stageActions}
							onopen={onopenFile}
							onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
						/>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h3>Untracked <span class="count">{untracked.length}</span></h3>
			{#if untracked.length === 0}
				<p class="empty">No files</p>
			{:else}
				<ul>
					{#each untracked as file (file.path)}
						<FileRow
							{file}
							actions={stageActions}
							onopen={onopenFile}
							onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
						/>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h3>Staged Changes <span class="count">{staged.length}</span></h3>
			{#if staged.length === 0}
				<p class="empty">No files</p>
			{:else}
				<ul>
					{#each staged as file (file.path)}
						<FileRow
							{file}
							actions={unstageActions}
							onopen={onopenFile}
							onaction={(id, path) => onaction(id as WorkingTreeAction, path)}
						/>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

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
		gap: var(--gg-space-1);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		background: transparent;
		color: var(--gg-fg);
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		cursor: pointer;
		padding: 2px var(--gg-space-2);
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
	.message {
		margin: var(--gg-space-2);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		padding: var(--gg-space-1) var(--gg-space-2);
		font: inherit;
		resize: vertical;
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
