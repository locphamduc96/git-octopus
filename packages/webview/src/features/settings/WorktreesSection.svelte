<script lang="ts">
	import { worktrees } from '../../lib/stores/worktrees.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';

	let branch = $state('');
	let path = $state('');
	const canAdd = $derived(branch.trim() !== '' && !worktrees.busy);
	const anyMissing = $derived((worktrees.list ?? []).some((worktree) => worktree.prunable));

	function add(): void {
		if (!canAdd) return;
		worktrees.add(branch.trim(), path.trim());
		branch = '';
		path = '';
	}
</script>

<section>
	{#if worktrees.list === null}
		<p class="note">Reading the worktrees…</p>
	{:else}
		{#each worktrees.list as worktree (worktree.path)}
			<div class="row">
				<span class="row-label">
					<span>
						{worktree.branch ?? `detached at ${worktree.head?.slice(0, 8) ?? '—'}`}
						{#if worktree.isMain}<span class="tag">main worktree</span>{/if}
						{#if worktree.isCurrent}<span class="tag">this window</span>{/if}
						{#if worktree.locked}<span class="tag">locked</span>{/if}
						{#if worktree.prunable}<span class="tag warn">folder missing</span>{/if}
					</span>
					<span class="note path" title={worktree.path}>{worktree.path}</span>
				</span>
				{#if !worktree.isCurrent && !worktree.prunable}
					<IconButton
						name="empty-window"
						label="Open {worktree.path} in a new window"
						title="Open in a new window"
						onclick={() => worktrees.open(worktree.path)}
					/>
				{/if}
				{#if !worktree.isMain && !worktree.isCurrent}
					<IconButton
						name="trash"
						label="Remove the worktree at {worktree.path}"
						title="Remove this worktree — its folder is deleted, the branch stays"
						disabled={worktrees.busy}
						onclick={() => worktrees.remove(worktree.path)}
					/>
				{/if}
			</div>
		{/each}
		{#if anyMissing}
			<div class="prune">
				<span class="note">Some worktrees point at folders that are gone.</span>
				<button class="secondary" disabled={worktrees.busy} onclick={worktrees.prune}>Prune</button>
			</div>
		{/if}
	{/if}
</section>

<section class="add">
	<span class="heading">Add a worktree</span>
	<span class="note"
		>An existing branch is checked out there; a new name creates the branch from HEAD. Leave the
		folder empty to be asked, with one beside the repository suggested.</span
	>
	<div class="fields">
		<input bind:value={branch} placeholder="Branch" aria-label="Worktree branch" />
		<input
			bind:value={path}
			placeholder="Folder (optional)"
			aria-label="Worktree folder"
			onkeydown={(event) => {
				if (event.key === 'Enter') add();
			}}
		/>
		<button class="primary" disabled={!canAdd} onclick={add}>Add</button>
	</div>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: var(--gg-space-2) 0;
		border-bottom: 1px solid color-mix(in srgb, var(--gg-fg) 8%, transparent);
	}
	.row-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.note {
		margin: 0;
		font-size: 0.8em;
		color: var(--gg-fg-muted);
	}
	.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.tag {
		margin-left: var(--gg-space-1);
		padding: 0 4px;
		font-size: 0.8em;
		color: var(--gg-fg-muted);
		border: 1px solid var(--gg-border);
		border-radius: 3px;
	}
	.tag.warn {
		color: var(--vscode-editorWarning-foreground, #cca700);
		border-color: currentColor;
	}
	.prune {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gg-space-2);
		padding: var(--gg-space-2) 0;
	}
	.secondary {
		flex: none;
		padding: 2px var(--gg-space-3);
		font: inherit;
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		background: var(--vscode-button-secondaryBackground, transparent);
		border: 1px solid var(--gg-border);
		border-radius: 2px;
		cursor: pointer;
	}
	.secondary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.add {
		gap: var(--gg-space-2);
		margin-top: var(--gg-space-3);
	}
	.heading {
		font-weight: 600;
	}
	.fields {
		display: flex;
		gap: var(--gg-space-2);
	}
	.fields input {
		min-width: 0;
		padding: 2px var(--gg-space-2);
		font: inherit;
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 2px;
	}
	.fields input:first-child {
		flex: 0 0 11em;
	}
	.fields input:nth-child(2) {
		flex: 1;
	}
	.primary {
		flex: none;
		padding: 2px var(--gg-space-3);
		font: inherit;
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border: none;
		border-radius: 2px;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
