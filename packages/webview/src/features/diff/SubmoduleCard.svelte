<script lang="ts">
	import Icon from '../../lib/ui/Icon.svelte';
	import type { SubmoduleDiffView } from '../../lib/stores/diffView.svelte';

	let {
		path,
		submodule,
		onopen,
	}: {
		path: string;
		submodule: SubmoduleDiffView;
		onopen: (repoPath: string) => void;
	} = $props();

	const short = (commit: string | undefined): string => commit?.slice(0, 8) ?? '';
	const what = $derived(
		submodule.from && submodule.to
			? submodule.from === submodule.to
				? 'still points at'
				: 'moves from'
			: submodule.to
				? 'is added at'
				: 'is removed from'
	);
</script>

<section class="submodule" aria-label="Submodule change">
	<p class="lead">
		<Icon name="file-submodule" />
		<span>
			Submodule <b>{path}</b>
			{what}
			{#if submodule.from && submodule.to && submodule.from !== submodule.to}
				<code>{short(submodule.from)}</code> → <code>{short(submodule.to)}</code>
			{:else}
				<code>{short(submodule.to ?? submodule.from)}</code>
			{/if}
		</span>
	</p>
	{#if submodule.dirty}
		<p class="note">
			Its checkout also has changes of its own, which this repository does not record — open it to
			see them.
		</p>
	{/if}
	{#if submodule.repoPath}
		<button class="primary" onclick={() => submodule.repoPath && onopen(submodule.repoPath)}>
			Open submodule
		</button>
	{:else}
		<p class="note">
			Not checked out here — run <code>git submodule update --init {path}</code> to open it.
		</p>
	{/if}
</section>

<style>
	.submodule {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3);
	}
	.lead {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
	}
	code {
		font-family: var(--gg-font-mono);
	}
	.note {
		margin: 0;
		color: var(--gg-fg-muted);
	}
	.primary {
		padding: 2px var(--gg-space-3);
		font: inherit;
		color: var(--gg-btn-fg);
		background: var(--gg-btn-bg);
		border: none;
		border-radius: var(--gg-radius);
		cursor: pointer;
	}
</style>
