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
		<button class="confirm" class:danger onclick={onconfirm}>{confirmLabel}</button>
		<button class="cancel" onclick={oncancel}>{cancelLabel}</button>
	{/snippet}
</Modal>

<style>
	p {
		margin: 0;
		line-height: 1.5;
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
	.confirm:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.confirm.danger {
		background: var(--vscode-inputValidation-errorBorder, #c74e39);
		color: #fff;
	}
	.cancel {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
	}
	.cancel:hover {
		background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
	}
</style>
