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
		background: var(--gg-scrim);
	}
	.card {
		display: flex;
		flex-direction: column;
		width: min(460px, 100%);
		max-height: 100%;
		overflow: hidden;
		background: var(--gg-bg-overlay);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius-xl);
		box-shadow: var(--gg-shadow);
	}
	/* Only the width widens; the shell above is every dialog's. */
	.card.wide {
		width: min(760px, 100%);
	}
	/* One title bar for every dialog, the same height as the Settings one. */
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		flex: none;
		height: var(--gg-dialog-head-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-4);
		border-bottom: 1px solid var(--gg-border);
	}
	.title {
		flex: none;
		font-size: var(--gg-text-lg);
		font-weight: 600;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		min-height: 0;
		overflow: auto;
		padding: var(--gg-space-3) var(--gg-space-4);
	}
	/*
	 * Cancel, then the main action, both on the right — the order VS Code's own dialogs end in, so the
	 * main button is always in the same corner. A dialog's secondary action (Regenerate, a question)
	 * sits apart on the left by giving itself `margin-right: auto`.
	 */
	footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--gg-space-2);
		flex: none;
		padding: var(--gg-space-3) var(--gg-space-4);
		border-top: 1px solid var(--gg-border);
	}
</style>
