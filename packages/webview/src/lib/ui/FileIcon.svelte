<script lang="ts">
	import { glyphFontSize, lookupFileIcon, lookupFolderIcon } from '../fileIcon';
	import { fileIconTheme } from '../stores/fileIcons.svelte';
	import Icon from './Icon.svelte';

	let {
		path,
		folder = false,
		expanded = false,
		fallback,
	}: {
		/** File path, or folder name when `folder` is set. */
		path: string;
		folder?: boolean;
		expanded?: boolean;
		/** Codicon drawn when the user has no icon theme, or it covers nothing for this path. */
		fallback: string;
	} = $props();

	const theme = $derived(fileIconTheme());
	const icon = $derived(
		folder ? lookupFolderIcon(theme, path, expanded) : lookupFileIcon(theme, path)
	);
</script>

{#if icon?.kind === 'image'}
	<img class="icon" src={icon.src} alt="" />
{:else if icon?.kind === 'glyph'}
	<span
		class="icon glyph"
		style:font-family={icon.fontId}
		style:color={icon.colour}
		style:font-size={glyphFontSize(theme, icon.fontId)}
		aria-hidden="true">{icon.char}</span
	>
{:else}
	<span class="icon codicon-slot"><Icon name={fallback} /></span>
{/if}

<style>
	.icon {
		flex: none;
		width: 16px;
		height: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	/* A glyph is sized as a share of the row's text, so it needs a line box of its own to sit in. */
	.glyph {
		line-height: 1;
		overflow: hidden;
	}
	.codicon-slot {
		opacity: 0.8;
	}
</style>
