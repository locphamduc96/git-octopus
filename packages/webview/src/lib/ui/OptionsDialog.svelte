<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';

	interface Option {
		id: string;
		label: string;
		description?: string;
		picked?: boolean;
	}

	let {
		title,
		listOptions,
		multi = false,
		onsubmit,
		oncancel,
	}: {
		title: string;
		listOptions: Option[];
		multi?: boolean;
		onsubmit: (listSelected: string[]) => void;
		oncancel: () => void;
	} = $props();

	// Options never change while the dialog is open — the initial snapshot is the point.
	let mapChecked = $state<Record<string, boolean>>(
		Object.fromEntries(
			untrack(() => listOptions).map((option) => [option.id, option.picked === true])
		)
	);
</script>

<Modal {title} onclose={oncancel}>
	{#snippet body()}
		<div class="options" role={multi ? 'group' : 'listbox'}>
			{#each listOptions as option (option.id)}
				{#if multi}
					<label class="option">
						<input type="checkbox" bind:checked={mapChecked[option.id]} />
						<span class="text">
							<span class="label">{option.label}</span>
							{#if option.description}<span class="description">{option.description}</span>{/if}
						</span>
					</label>
				{:else}
					<!-- Single choice: picking is the whole interaction, like a menu row. -->
					<button class="option choice" onclick={() => onsubmit([option.id])}>
						<span class="text">
							<span class="label">{option.label}</span>
							{#if option.description}<span class="description">{option.description}</span>{/if}
						</span>
					</button>
				{/if}
			{/each}
		</div>
	{/snippet}
	{#snippet actions()}
		{#if multi}
			<button
				class="confirm"
				onclick={() => onsubmit(listOptions.filter((option) => mapChecked[option.id]).map((option) => option.id))}
			>
				OK
			</button>
		{/if}
		<button class="cancel" onclick={oncancel}>Cancel</button>
	{/snippet}
</Modal>

<style>
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
	}
	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--gg-space-2);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-radius: 4px;
	}
	.option:hover {
		background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12));
	}
	button.choice {
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		width: 100%;
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.description {
		color: var(--gg-fg-muted);
		font-size: 0.92em;
	}
	.confirm,
	.cancel {
		border: none;
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-4);
	}
	.confirm {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.confirm:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.cancel {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
	}
</style>
