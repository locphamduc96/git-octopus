<script lang="ts">
	import Modal from '../../lib/ui/Modal.svelte';

	let {
		stagedCount,
		oncommit,
		oncancel,
	}: {
		stagedCount: number;
		oncommit: (message: string) => void;
		oncancel: () => void;
	} = $props();

	let summary = $state('');
	let description = $state('');

	const canCommit = $derived(summary.trim() !== '');

	/** Git convention: subject, blank line, then the body. */
	function submit(): void {
		if (!canCommit) return;
		const body = description.trim();
		oncommit(body === '' ? summary.trim() : `${summary.trim()}\n\n${body}`);
	}
</script>

<Modal title="Commit {stagedCount} staged file{stagedCount === 1 ? '' : 's'}" onclose={oncancel}>
	{#snippet body()}
		<label>
			Summary
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				bind:value={summary}
				placeholder="Short description of the change"
				onkeydown={(event) => {
					if (event.key === 'Enter') submit();
				}}
			/>
		</label>
		<label>
			Description <span class="optional">(optional)</span>
			<textarea bind:value={description} rows="6" placeholder="Why the change was made"></textarea>
		</label>
		<p class="hint">Press Ctrl/Cmd + Enter in the description to commit.</p>
	{/snippet}
	{#snippet actions()}
		<button class="confirm" disabled={!canCommit} onclick={submit}>Commit</button>
		<button class="cancel" onclick={oncancel}>Cancel</button>
	{/snippet}
</Modal>

<svelte:window
	onkeydown={(event) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit();
	}}
/>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.optional {
		opacity: 0.7;
	}
	input,
	textarea {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: var(--gg-space-1) var(--gg-space-2);
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: 1px solid var(--vscode-focusBorder);
	}
	.hint {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.8em;
	}
	button {
		border: none;
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-4);
	}
	.confirm {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.confirm:hover:not(:disabled) {
		background: var(--vscode-button-hoverBackground);
	}
	.confirm:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cancel {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
	}
</style>
