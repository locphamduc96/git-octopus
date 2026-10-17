<script lang="ts">
	import Modal from '../../lib/ui/Modal.svelte';
	import { formatKeys, LIST_SHORTCUT_GROUPS } from '../../lib/shortcuts';

	let { onclose }: { onclose: () => void } = $props();

	const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
</script>

<Modal title="Keyboard shortcuts" {onclose} wide>
	{#snippet body()}
		<div class="groups">
			{#each LIST_SHORTCUT_GROUPS as group (group.title)}
				<section>
					<h3>{group.title}</h3>
					<dl>
						{#each group.listItems as item (item.label)}
							<dt>
								{#each item.keys as keys, index (keys)}
									{#if index > 0}<span class="or">/</span>{/if}<kbd>{formatKeys(keys, isMac)}</kbd>
								{/each}
							</dt>
							<dd>{item.label}</dd>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	{/snippet}
	{#snippet actions()}
		<button class="primary" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--gg-space-3) var(--gg-space-4);
		overflow: auto;
	}
	h3 {
		margin: 0 0 var(--gg-space-1);
		font-size: var(--gg-text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--gg-fg-muted);
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--gg-space-1) var(--gg-space-3);
		margin: 0;
	}
	dt {
		white-space: nowrap;
	}
	dd {
		margin: 0;
	}
	kbd {
		display: inline-block;
		padding: 0 4px;
		font: inherit;
		font-size: var(--gg-text-sm);
		border: 1px solid var(--gg-border);
		border-bottom-width: 2px;
		border-radius: var(--gg-radius-sm);
		background: var(--gg-kbd-bg);
		color: var(--gg-kbd-fg);
	}
	.or {
		margin: 0 4px;
		color: var(--gg-fg-muted);
	}
	/* The one way out, drawn as the main button like every other dialog's. */
	.primary {
		border: none;
		border-radius: var(--gg-radius);
		padding: var(--gg-space-1) var(--gg-space-4);
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		font: inherit;
		cursor: pointer;
	}
	.primary:hover {
		background: var(--gg-btn-hover);
	}
</style>
