<script lang="ts">
	import Modal from './Modal.svelte';

	let {
		title,
		message,
		confirmLabel = 'Yes',
		cancelLabel = 'No',
		danger = false,
		onconfirm,
		oncancel,
	}: {
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<Modal {title} onclose={oncancel}>
	{#snippet body()}
		<p>{message}</p>
	{/snippet}
	{#snippet actions()}
		<button class="cancel" onclick={oncancel}>{cancelLabel}</button>
		<button class="confirm" class:danger onclick={onconfirm}>{confirmLabel}</button>
	{/snippet}
</Modal>

<style>
	p {
		margin: 0;
		line-height: 1.5;
	}
	button {
		border: none;
		border-radius: var(--gg-radius);
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-4);
	}
	.confirm {
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
	}
	.confirm:hover {
		background: var(--gg-btn-hover);
	}
	.confirm.danger {
		background: var(--gg-btn-danger-bg);
		color: var(--gg-btn-danger-fg);
	}
	.cancel {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
		border: 1px solid var(--gg-border);
	}
	.cancel:hover {
		background: var(--gg-btn2-hover);
	}
</style>
