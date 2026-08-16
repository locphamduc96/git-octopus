<script lang="ts">
	import type { GitIdentity } from '@git-octopus/shared';
	import Modal from '../../lib/ui/Modal.svelte';

	let {
		onsave,
		onclose,
	}: {
		onsave: (identity: GitIdentity) => void;
		onclose: () => void;
	} = $props();

	let draft = $state({ label: '', name: '', email: '', hostPattern: '' });

	const valid = $derived(draft.label.trim() !== '' && draft.email.trim() !== '');

	function save(): void {
		const hostPattern = draft.hostPattern.trim();
		onsave({
			label: draft.label.trim(),
			name: draft.name.trim(),
			email: draft.email.trim(),
			...(hostPattern !== '' ? { hostPattern } : {}),
		});
	}
</script>

<Modal title="Add Git identity" {onclose}>
	{#snippet body()}
		<label>
			Label
			<!-- svelte-ignore a11y_autofocus -->
			<input placeholder="Work, Personal…" bind:value={draft.label} autofocus />
		</label>
		<label>
			User name
			<input placeholder="user.name" bind:value={draft.name} />
		</label>
		<label>
			Email
			<input placeholder="user.email" bind:value={draft.email} />
		</label>
		<label>
			Suggest for remotes containing (optional)
			<input placeholder="github.com/mycompany" bind:value={draft.hostPattern} />
		</label>
	{/snippet}
	{#snippet actions()}
		<button onclick={onclose}>Cancel</button>
		<button class="primary" onclick={save} disabled={!valid}>Save identity</button>
	{/snippet}
</Modal>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		font-size: 0.9em;
		color: var(--gg-fg-muted);
	}
	input {
		background: var(--vscode-input-background, var(--gg-bg));
		color: var(--vscode-input-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 3px var(--gg-space-2);
	}
	button {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		font: inherit;
		padding: 3px var(--gg-space-3);
		cursor: pointer;
	}
	button.primary {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
