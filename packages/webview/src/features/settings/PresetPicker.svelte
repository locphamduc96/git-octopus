<script module lang="ts">
	/** The option value that stands for "none of the presets" and opens the free-text field. */
	export const CUSTOM = '__custom__';

	export interface PresetOption {
		value: string;
		label: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		ariaLabel = label,
		note,
		listOptions,
		value,
		disabled = false,
		customPlaceholder,
		onsave,
	}: {
		label: string;
		/** Overrides `label` for the radio group, when the visible heading is too terse to stand alone. */
		ariaLabel?: string;
		note?: Snippet;
		/** Rendered verbatim, in order. Include an option valued {@link CUSTOM} to offer free text. */
		listOptions: PresetOption[];
		/** The stored setting. A value no preset carries is what puts the picker in custom mode. */
		value: string;
		disabled?: boolean;
		customPlaceholder?: string;
		onsave: (value: string) => void;
	} = $props();

	/**
	 * Both are derived from the stored value and assigned over on a click, so a draft is overwritten
	 * exactly when the stored value really changes — a recompute landing on the value it already
	 * held notifies nobody, and the draft stands. That is the behaviour worth having: the host
	 * answers every save by broadcasting all of the settings, and a save of some other setting must
	 * not wipe what is being typed here. It does rely on `value` arriving through a derived of its
	 * own rather than read off the inventory object — see the callers in `SettingsWidget`.
	 */
	let custom = $derived(value !== '' && !listOptions.some((option) => option.value === value));
	let draft = $derived(value);

	const selected = $derived(custom ? CUSTOM : draft);

	function pick(next: string): void {
		if (next === CUSTOM) {
			custom = true;
			return;
		}
		custom = false;
		draft = next;
		onsave(next);
	}
</script>

<div class="pick-group">
	<div class="pick-head">
		{label}
		{#if note}<span class="note">{@render note()}</span>{/if}
	</div>
	{#if listOptions.length > 0}
		<div class="chips" role="radiogroup" aria-label={ariaLabel}>
			{#each listOptions as option (option.value)}
				<button
					class="chip"
					class:on={selected === option.value}
					{disabled}
					role="radio"
					aria-checked={selected === option.value}
					onclick={() => pick(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
	{#if custom && customPlaceholder !== undefined}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="model"
			autofocus
			placeholder={customPlaceholder}
			{disabled}
			bind:value={draft}
			onchange={() => onsave(draft)}
			onkeydown={(event) => {
				if (event.key === 'Enter') onsave(draft);
			}}
		/>
	{/if}
</div>

<style>
	.pick-group {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		padding: var(--gg-space-2) 0;
		border-top: 1px solid color-mix(in srgb, var(--gg-fg) 8%, transparent);
	}
	.note {
		margin: 0;
		font-size: 0.85em;
		color: var(--gg-fg-muted);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gg-space-1);
	}
	.chip {
		padding: 2px 10px;
		background: transparent;
		border: 1px solid var(--gg-border);
		border-radius: 10px;
		color: var(--gg-fg-muted);
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
	}
	.chip:hover:not(:disabled):not(.on) {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--gg-fg);
	}
	.chip.on {
		border-color: var(--gg-accent);
		background: color-mix(in srgb, var(--gg-accent) 10%, transparent);
		color: var(--gg-fg);
	}
	.chip:disabled {
		opacity: 0.5;
		cursor: default;
	}
	input.model {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 2px var(--gg-space-1);
		width: 170px;
	}
	input.model:focus {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
