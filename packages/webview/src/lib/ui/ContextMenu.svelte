<script lang="ts">
	interface MenuItem {
		id: string;
		label: string;
		separatorBefore?: boolean;
	}

	let {
		x,
		y,
		items,
		onselect,
		onclose,
	}: {
		x: number;
		y: number;
		items: MenuItem[];
		onselect: (id: string) => void;
		onclose: () => void;
	} = $props();
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<button class="backdrop" onclick={onclose} oncontextmenu={(e) => e.preventDefault()} aria-label="Close menu"
></button>
<ul class="menu" style="left:{x}px; top:{y}px">
	{#each items as item (item.id)}
		{#if item.separatorBefore}
			<li class="sep" role="separator"></li>
		{/if}
		<li>
			<button onclick={() => onselect(item.id)}>{item.label}</button>
		</li>
	{/each}
</ul>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		padding: 0;
		z-index: 10;
		cursor: default;
	}
	.menu {
		position: fixed;
		z-index: 11;
		margin: 0;
		padding: var(--gg-space-1) 0;
		list-style: none;
		min-width: 200px;
		background: var(--vscode-menu-background, var(--gg-bg));
		color: var(--vscode-menu-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-menu-border, var(--gg-border));
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
	}
	.menu button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-3);
	}
	.menu button:hover {
		background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
		color: var(--vscode-menu-selectionForeground, inherit);
	}
	.sep {
		height: 1px;
		margin: var(--gg-space-1) 0;
		background: var(--gg-border);
	}
</style>
