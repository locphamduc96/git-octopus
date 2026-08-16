<script lang="ts">
	/**
	 * A button whose whole content is one icon.
	 *
	 * The centring is the point. A codicon is an inline-block glyph, so in an ordinary button it
	 * sits on the text baseline — which leaves it a pixel or two high, and off by more as soon as
	 * the button sits in a row with taller neighbours. A fixed square with the glyph flex-centred in
	 * it cannot drift, and gives every icon control the same hit area.
	 */
	import Icon from './Icon.svelte';
	import { tooltip } from './tooltip';

	let {
		name,
		label,
		title,
		disabled = false,
		onclick,
	}: {
		/** Codicon id, without the `codicon-` prefix. */
		name: string;
		/** Screen-reader name for the control; the icon is its only content. */
		label: string;
		/** Hover text. Defaults to the label. */
		title?: string;
		disabled?: boolean;
		onclick: (event: MouseEvent) => void;
	} = $props();
</script>

<button class="icon-button" {disabled} {onclick} use:tooltip={title ?? label}>
	<Icon {name} {label} />
</button>

<style>
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--gg-hit);
		height: var(--gg-hit);
		padding: 0;
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
		line-height: 0;
	}
	.icon-button:hover:not(:disabled) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.icon-button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
