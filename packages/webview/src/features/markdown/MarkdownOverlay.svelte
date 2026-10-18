<script lang="ts">
	import { markdownPanel } from '../../lib/stores/markdown.svelte';

	const shown = $derived(markdownPanel.shown);

	/**
	 * The panel, and the Markdown library inside it, load the first time something is shown: the
	 * extension never shows one, and the desktop app only after an AI explanation.
	 */
	const loadPanel = () => import('./MarkdownPanel.svelte');

	function focusOnMount(element: HTMLElement): void {
		element.focus();
	}

	/**
	 * Scoped to the overlay: a dialog opened above it keeps its own Escape. Nothing typed here goes
	 * on to the window shortcuts of the graph hidden underneath (arrows, Cmd+Z, Cmd+R …).
	 */
	function onkeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Escape') markdownPanel.close();
	}
</script>

{#if shown}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label={shown.title}
		tabindex="-1"
		{onkeydown}
		use:focusOnMount
	>
		{#await loadPanel() then { default: Panel }}
			<Panel
				title={shown.title}
				content={shown.content}
				oncopy={markdownPanel.copy}
				onsave={markdownPanel.save}
				onopenlink={markdownPanel.openLink}
				onclose={markdownPanel.close}
			/>
		{:catch}
			<p class="failed">The viewer could not be loaded. Press Escape to close.</p>
		{/await}
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: var(--gg-bg);
	}
	.overlay:focus {
		outline: none;
	}
	.failed {
		margin: var(--gg-space-4);
		color: var(--gg-fg-muted);
	}
</style>
