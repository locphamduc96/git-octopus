<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	let {
		value,
		options,
		label,
		filterable = false,
		onchange,
	}: {
		value: string;
		options: Option[];
		label?: string;
		filterable?: boolean;
		onchange: (value: string) => void;
	} = $props();

	import Icon from './Icon.svelte';

	let open = $state(false);
	let filter = $state('');

	const current = $derived(options.find((option) => option.value === value)?.label ?? value);
	const visible = $derived(
		filter.trim() === ''
			? options
			: options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase()))
	);

	function pick(next: string): void {
		open = false;
		filter = '';
		onchange(next);
	}
</script>

<div class="dropdown">
	{#if label}<span class="label">{label}</span>{/if}
	<button class="trigger" onclick={() => (open = !open)} title={current}>
		<span class="value">{current}</span>
		<Icon name="chevron-down" />
	</button>

	{#if open}
		<button class="backdrop" onclick={() => (open = false)} aria-label="Close"></button>
		<div class="menu">
			{#if filterable}
				<!-- svelte-ignore a11y_autofocus -->
				<input class="filter" bind:value={filter} placeholder="Filter…" autofocus />
			{/if}
			<ul>
				{#each visible as option (option.value)}
					<li>
						<button class:selected={option.value === value} onclick={() => pick(option.value)}>
							{option.label}
						</button>
					</li>
				{/each}
				{#if visible.length === 0}
					<li class="empty">No matches</li>
				{/if}
			</ul>
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		min-width: 0;
	}
	.label {
		color: var(--gg-fg-muted);
		white-space: nowrap;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		max-width: 220px;
		background: var(--vscode-dropdown-background, var(--gg-bg));
		color: var(--vscode-dropdown-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-dropdown-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
		padding: 1px var(--gg-space-2);
	}
	.value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.trigger :global(.codicon) {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: 12px;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		padding: 0;
		z-index: 20;
		cursor: default;
	}
	.menu {
		position: absolute;
		z-index: 21;
		top: calc(100% + 2px);
		left: 0;
		min-width: 200px;
		max-width: 320px;
		background: var(--vscode-dropdown-background, var(--gg-bg));
		border: 1px solid var(--vscode-dropdown-border, var(--gg-border));
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
		padding: var(--gg-space-1);
	}
	.filter {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: var(--gg-space-1);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 1px var(--gg-space-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow: auto;
	}
	ul button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 2px var(--gg-space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	ul button:hover {
		background: var(--vscode-list-hoverBackground);
	}
	ul button.selected {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.empty {
		padding: 2px var(--gg-space-2);
		color: var(--gg-fg-muted);
	}
</style>
