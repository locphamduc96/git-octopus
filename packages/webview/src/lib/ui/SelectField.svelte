<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ChangeEventHandler } from 'svelte/elements';

	/**
	 * A native `<select>` drawn in the theme's colours. The browser keeps the keyboard, the screen
	 * reader and the platform's own list; only the closed box is ours, so it sits with the inputs and
	 * buttons around it instead of looking borrowed from the OS.
	 */
	let {
		value = $bindable(),
		small = false,
		disabled = false,
		'aria-label': ariaLabel,
		onchange,
		children,
	}: {
		value?: string;
		/** The compact size, for a select inside a list row. */
		small?: boolean;
		disabled?: boolean;
		'aria-label'?: string;
		onchange?: ChangeEventHandler<HTMLSelectElement>;
		children: Snippet;
	} = $props();
</script>

<span class="select-field" class:small>
	<select bind:value {disabled} aria-label={ariaLabel} {onchange}>{@render children()}</select>
	<span class="codicon codicon-chevron-down" aria-hidden="true"></span>
</span>

<style>
	.select-field {
		position: relative;
		display: inline-flex;
		width: 100%;
		min-width: 0;
	}
	.select-field.small {
		width: auto;
	}
	select {
		appearance: none;
		width: 100%;
		height: var(--gg-control-h);
		padding: 0 24px 0 var(--gg-space-2);
		border: 1px solid var(--gg-dropdown-border);
		border-radius: var(--gg-radius);
		background: var(--gg-dropdown-bg);
		color: var(--gg-dropdown-fg);
		font: inherit;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.small select {
		height: var(--gg-hit);
		padding-right: 20px;
		font-size: var(--gg-text-sm);
	}
	select:focus-visible {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	select:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.codicon {
		position: absolute;
		top: 50%;
		right: 6px;
		transform: translateY(-50%);
		font-size: var(--gg-icon-sm);
		color: var(--gg-fg-muted);
		pointer-events: none;
	}
	.small .codicon {
		right: 4px;
		font-size: var(--gg-icon-xs);
	}
</style>
