<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';

	let {
		title,
		prompt = '',
		value = '',
		multiline = false,
		required = false,
		onsubmit,
		oncancel,
	}: {
		title: string;
		prompt?: string;
		value?: string;
		multiline?: boolean;
		required?: boolean;
		onsubmit: (text: string) => void;
		oncancel: () => void;
	} = $props();

	// The prefill is a one-time snapshot; the field owns the value from then on.
	let text = $state(untrack(() => value));
	const blocked = $derived(required && text.trim() === '');

	function submit(): void {
		if (!blocked) onsubmit(text);
	}

	/** Enter submits a single-line field; a multiline editor keeps Enter and submits on Ctrl/Cmd. */
	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		if (multiline && !(event.ctrlKey || event.metaKey)) return;
		event.preventDefault();
		submit();
	}

	function focusOnMount(element: HTMLElement): void {
		element.focus();
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			element.select();
		}
	}
</script>

<Modal {title} onclose={oncancel}>
	{#snippet body()}
		<div class="field">
			{#if prompt}<p class="prompt">{prompt}</p>{/if}
			{#if multiline}
				<textarea rows="5" bind:value={text} {onkeydown} use:focusOnMount></textarea>
				<p class="hint">Ctrl/Cmd + Enter to confirm</p>
			{:else}
				<input type="text" bind:value={text} {onkeydown} use:focusOnMount />
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<button class="cancel" onclick={oncancel}>Cancel</button>
		<button class="confirm" disabled={blocked} onclick={submit}>OK</button>
	{/snippet}
</Modal>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
	}
	.prompt {
		margin: 0;
		color: var(--gg-fg-muted);
	}
	input,
	textarea {
		font: inherit;
		color: var(--gg-input-fg);
		background: var(--gg-input-bg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
		padding: var(--gg-space-1) var(--gg-space-2);
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	.hint {
		margin: 0;
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
	}
	.confirm,
	.cancel {
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
	.confirm:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.confirm:not(:disabled):hover {
		background: var(--gg-btn-hover);
	}
	.cancel {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
		border: 1px solid var(--gg-border);
	}
</style>
