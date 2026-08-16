<script lang="ts">
	interface Option {
		value: string;
		label: string;
		/** Consecutive options sharing a group are printed under one heading. */
		group?: string;
	}

	let {
		value,
		options,
		label,
		placeholder = '',
		filterable = false,
		columns = false,
		heading,
		triggerIcon,
		triggerTitle,
		onchange,
	}: {
		value: string;
		options: Option[];
		label?: string;
		/** Shown on the trigger when no option matches `value` — e.g. a detached HEAD. */
		placeholder?: string;
		filterable?: boolean;
		/** Lay each group out as its own column instead of stacking them into one list. */
		columns?: boolean;
		/** Draws a group's heading; the plain group name is used when it is not given. */
		heading?: Snippet<[string]>;
		/**
		 * Opens from an icon instead of a box showing the current value. For a menu whose value is
		 * displayed elsewhere — printing it twice, once inside the control and once beside it, only
		 * raises the question of which one is the real answer.
		 */
		triggerIcon?: string;
		triggerTitle?: string;
		onchange: (value: string) => void;
	} = $props();

	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';

	let open = $state(false);
	let filter = $state('');

	const current = $derived(
		options.find((option) => option.value === value)?.label ?? (value === '' ? placeholder : value)
	);
	const visible = $derived(
		filter.trim() === ''
			? options
			: options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase()))
	);
	/** A heading is carried by the first option of each run, so filtering never orphans one. */
	const listItems = $derived(
		visible.map((option, index) => ({
			option,
			heading: option.group && option.group !== visible[index - 1]?.group ? option.group : null,
		}))
	);
	/**
	 * One column per group name, in first-seen order — grouped by name rather than by consecutive
	 * runs, since the columns are keyed by name and a repeated run would repeat the key.
	 */
	const listColumns = $derived.by(() => {
		const mapGroups = new Map<string, Option[]>();
		for (const option of visible) {
			const name = option.group ?? '';
			const listOptions = mapGroups.get(name);
			if (listOptions) listOptions.push(option);
			else mapGroups.set(name, [option]);
		}
		return [...mapGroups.entries()].map(([name, listOptions]) => ({ name, listOptions }));
	});

	function pick(next: string): void {
		open = false;
		filter = '';
		onchange(next);
	}
</script>

<div class="dropdown">
	{#if label}<span class="label">{label}</span>{/if}
	{#if triggerIcon}
		<IconButton
			name={triggerIcon}
			label={triggerTitle ?? current}
			title={triggerTitle ?? current}
			onclick={() => (open = !open)}
		/>
	{:else}
		<button class="trigger" onclick={() => (open = !open)} title={current}>
			<span class="value">{current}</span>
			<Icon name="chevron-down" />
		</button>
	{/if}

	{#if open}
		<button class="backdrop" onclick={() => (open = false)} aria-label="Close"></button>
		<div class="menu" class:wide={columns}>
			{#if filterable}
				<!-- svelte-ignore a11y_autofocus -->
				<input class="filter" bind:value={filter} placeholder="Filter…" autofocus />
			{/if}
			{#if columns}
				<div class="columns">
					{#each listColumns as column (column.name)}
						<div class="column">
							{#if column.name}
								<div class="heading">
									{#if heading}{@render heading(column.name)}{:else}{column.name}{/if}
								</div>
							{/if}
							<ul>
								{#each column.listOptions as option (option.value)}
									<li>
										<button
											class:selected={option.value === value}
											onclick={() => pick(option.value)}
											title={option.label}
										>
											{option.label}
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
					{#if visible.length === 0}
						<p class="empty">No matches</p>
					{/if}
				</div>
			{:else}
				<ul>
					{#each listItems as item (item.option.value)}
						{#if item.heading}
							<li class="heading">{item.heading}</li>
						{/if}
						<li>
							<button
								class:selected={item.option.value === value}
								onclick={() => pick(item.option.value)}
								title={item.option.label}
							>
								{item.option.label}
							</button>
						</li>
					{/each}
					{#if visible.length === 0}
						<li class="empty">No matches</li>
					{/if}
				</ul>
			{/if}
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
		min-width: 0;
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
		border-radius: var(--gg-radius-item);
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
	.heading {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		padding: var(--gg-space-1) var(--gg-space-2) 0;
		color: var(--gg-fg-muted);
		font-size: 0.8em;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	/*
	 * Columns, not one long list: local and remote hold the same branch names, so side by side each
	 * name is read once and the pair is obvious. Each column scrolls on its own — a repository with
	 * forty remote branches and three local ones must not push the local column off-screen.
	 */
	.menu.wide {
		max-width: min(620px, 90vw);
	}
	.columns {
		display: flex;
		align-items: flex-start;
		gap: var(--gg-space-2);
	}
	.column {
		flex: 1 1 0;
		min-width: 0;
	}
	.column + .column {
		border-left: 1px solid var(--gg-border);
		padding-left: var(--gg-space-2);
	}
	.columns .empty {
		margin: 0;
		padding: 2px var(--gg-space-2);
		color: var(--gg-fg-muted);
	}
</style>
