<script lang="ts">
	import Modal from '../../lib/ui/Modal.svelte';

	let {
		title,
		prompt,
		secret,
		confirm,
		onanswer,
		oncancel,
	}: {
		/** The host's own words: what is running, in which repository, against which hosts. */
		title: string;
		/** What git or ssh asked. Data from outside: only ever shown as text. */
		prompt: string;
		/** Mask what is typed. */
		secret: boolean;
		/** A yes/no question (a host key to trust): two buttons instead of a field. */
		confirm: boolean;
		onanswer: (answer: string) => void;
		oncancel: () => void;
	} = $props();

	let text = $state('');

	function submit(): void {
		onanswer(text);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		submit();
	}

	function focusOnMount(element: HTMLElement): void {
		element.focus();
	}
</script>

<Modal {title} onclose={oncancel}>
	{#snippet body()}
		<p class="prompt">{prompt}</p>
		{#if !confirm}
			{#if secret}
				<input
					type="password"
					aria-label="Password"
					autocomplete="off"
					spellcheck="false"
					bind:value={text}
					{onkeydown}
					use:focusOnMount
				/>
			{:else}
				<input
					type="text"
					aria-label="Username"
					autocomplete="off"
					spellcheck="false"
					bind:value={text}
					{onkeydown}
					use:focusOnMount
				/>
			{/if}
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if confirm}
			<!-- The refusal is focused: Enter on a question nobody expected changes nothing. -->
			<button class="cancel" onclick={() => onanswer('no')} use:focusOnMount>No</button>
			<button class="confirm" onclick={() => onanswer('yes')}>Yes</button>
		{:else}
			<button class="cancel" onclick={oncancel}>Cancel</button>
			<button class="confirm" onclick={submit}>OK</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.prompt {
		margin: 0;
		line-height: 1.5;
		color: var(--gg-fg-muted);
		overflow-wrap: anywhere;
		user-select: text;
	}
	input {
		font: inherit;
		color: var(--gg-input-fg);
		background: var(--gg-input-bg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
		padding: var(--gg-space-1) var(--gg-space-2);
	}
	input:focus {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
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
	.confirm:hover {
		background: var(--gg-btn-hover);
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
