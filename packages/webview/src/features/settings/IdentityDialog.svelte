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
		font-size: var(--gg-text-sm);
		color: var(--gg-fg-muted);
	}
	input {
		background: var(--gg-input-bg);
		color: var(--gg-input-fg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
		font: inherit;
		padding: 3px var(--gg-space-2);
	}
	button {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		font: inherit;
		padding: 3px var(--gg-space-3);
		cursor: pointer;
	}
	button.primary {
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		border-color: transparent;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
