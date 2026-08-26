<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		onclose,
		body,
		actions,
		headerExtra,
		wide = false,
	}: {
		title: string;
		onclose: () => void;
		body: Snippet;
		actions: Snippet;
		/** Rendered in the header after the title — a count, a mode switch. */
		headerExtra?: Snippet;
		/** A roomier card for content-heavy dialogs (editable lists, multi-field forms). */
		wide?: boolean;
	} = $props();
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<div class="backdrop">
	<div class="card" class:wide role="dialog" aria-modal="true" aria-label={title}>
		<header>
			<span class="title">{title}</span>
			{#if headerExtra}{@render headerExtra()}{/if}
		</header>
		<div class="body">{@render body()}</div>
		<footer>{@render actions()}</footer>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--gg-space-4);
		background: rgba(0, 0, 0, 0.45);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-3);
		width: min(460px, 100%);
		max-height: 100%;
		padding: var(--gg-space-3);
		background: var(--vscode-editorWidget-background, var(--gg-bg));
		border: 1px solid var(--gg-border);
		border-radius: 6px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}
	/* Only the width widens; the shell above is every dialog's. */
	.card.wide {
		width: min(760px, 100%);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
	}
	.title {
		font-weight: 600;
		flex: none;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		min-height: 0;
		overflow: auto;
	}
	footer {
		display: flex;
		align-items: center;
		/* Confirm and cancel sit at opposite edges so neither is hit by accident. */
		justify-content: space-between;
		gap: var(--gg-space-3);
	}
</style>
