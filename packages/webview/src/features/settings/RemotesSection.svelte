<script lang="ts">
	import { remotes } from '../../lib/stores/remotes.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';

	let name = $state('');
	let url = $state('');
	const canAdd = $derived(name.trim() !== '' && url.trim() !== '' && !remotes.busy);

	function add(): void {
		if (!canAdd) return;
		remotes.add(name.trim(), url.trim());
		name = '';
		url = '';
	}
</script>

<section>
	{#if remotes.list === null}
		<p class="note">Reading the remotes…</p>
	{:else if remotes.list.length === 0}
		<p class="note">This repository has no remote yet.</p>
	{:else}
		{#each remotes.list as remote (remote.name)}
			<div class="row">
				<span class="row-label">
					{remote.name}
					<span class="note url">{remote.fetchUrl}</span>
					{#if remote.pushUrl}<span class="note url">push: {remote.pushUrl}</span>{/if}
				</span>
				<IconButton
					name="trash"
					label="Remove {remote.name}"
					title="Remove {remote.name} from this clone"
					disabled={remotes.busy}
					onclick={() => remotes.remove(remote.name)}
				/>
			</div>
		{/each}
	{/if}
</section>

<section class="add">
	<span class="heading">Add a remote</span>
	<div class="fields">
		<input bind:value={name} placeholder="Name, e.g. upstream" aria-label="Remote name" />
		<input
			bind:value={url}
			placeholder="URL, e.g. git@github.com:owner/repo.git"
			aria-label="Remote URL"
			onkeydown={(event) => {
				if (event.key === 'Enter') add();
			}}
		/>
		<button class="primary" disabled={!canAdd} onclick={add}>Add &amp; fetch</button>
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
		gap: var(--gg-space-4);
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
	.url {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--vscode-editor-font-family, monospace);
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
		flex: 0 0 9em;
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
