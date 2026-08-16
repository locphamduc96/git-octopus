<script lang="ts">
	import IconButton from '../../lib/ui/IconButton.svelte';

	let {
		query,
		matchCount,
		onquery,
		onclose,
	}: {
		query: string;
		matchCount: number;
		onquery: (query: string) => void;
		onclose: () => void;
	} = $props();
</script>

<div class="find">
	<!-- svelte-ignore a11y_autofocus -->
	<input
		autofocus
		value={query}
		placeholder="Find commits…"
		oninput={(event) => onquery(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === 'Escape') onclose();
		}}
	/>
	<span class="count">{query === '' ? '' : `${matchCount} matches`}</span>
	<IconButton name="close" label="Close find" title="Close (Esc)" onclick={onclose} />
</div>

<style>
	.find {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		background: var(--vscode-editorWidget-background, var(--gg-bg));
	}
	input {
		flex: 1;
		min-width: 0;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-focusBorder, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 1px var(--gg-space-2);
	}
	.count {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		white-space: nowrap;
	}
</style>
