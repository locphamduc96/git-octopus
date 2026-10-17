<script lang="ts">
	import type { LfsDiff } from '../../lib/stores/diffView.svelte';

	let { lfs }: { lfs: LfsDiff } = $props();

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<section class="lfs" aria-label="Git LFS object">
	<p class="lead">
		Stored by Git LFS — git keeps a pointer, the content lives on the LFS server. What each side
		points at:
	</p>
	<dl>
		{#each [['Before', lfs.before], ['After', lfs.after]] as const as [label, pointer] (label)}
			<dt>{label}</dt>
			<dd>
				{#if pointer}
					<span class="size">{formatBytes(pointer.size)}</span>
					<span class="oid" title={pointer.oid}>oid {pointer.oid.slice(0, 12)}</span>
				{:else}
					<span class="none">not an LFS object here</span>
				{/if}
			</dd>
		{/each}
	</dl>
</section>

<style>
	.lfs {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3);
	}
	.lead {
		margin: 0;
		color: var(--gg-fg-muted);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--gg-space-1) var(--gg-space-3);
		margin: 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		display: flex;
		gap: var(--gg-space-3);
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.oid {
		font-family: var(--gg-font-mono);
		color: var(--gg-fg-muted);
	}
	.none {
		color: var(--gg-fg-muted);
		font-style: italic;
	}
</style>
