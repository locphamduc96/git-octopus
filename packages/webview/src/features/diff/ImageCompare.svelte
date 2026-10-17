<script lang="ts">
	import type { ImageDiff } from '../../lib/stores/diffView.svelte';

	let { image }: { image: ImageDiff } = $props();

	type View = 'sides' | 'overlay';
	let view = $state<View>('sides');
	/** How much of the new side shows over the old one, in overlay. */
	let mix = $state(50);
	let mapSize = $state<Record<'before' | 'after', string>>({ before: '', after: '' });
	/** Below this on both sides, an image is blown up pixel by pixel — a sprite or an icon. */
	const SMALL_PX = 64;
	let mapSmall = $state<Record<'before' | 'after', boolean>>({ before: false, after: false });

	const both = $derived(image.before !== undefined && image.after !== undefined);

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function measured(side: 'before' | 'after', event: Event): void {
		const element = event.currentTarget as HTMLImageElement;
		mapSize = { ...mapSize, [side]: `${element.naturalWidth} × ${element.naturalHeight} px` };
		mapSmall = {
			...mapSmall,
			[side]: element.naturalWidth < SMALL_PX && element.naturalHeight < SMALL_PX,
		};
	}
</script>

<div class="images">
	{#if both}
		<div class="views" role="radiogroup" aria-label="Image comparison">
			<button
				role="radio"
				aria-checked={view === 'sides'}
				class:on={view === 'sides'}
				onclick={() => (view = 'sides')}>Side by side</button
			>
			<button
				role="radio"
				aria-checked={view === 'overlay'}
				class:on={view === 'overlay'}
				onclick={() => (view = 'overlay')}>Overlay</button
			>
		</div>
	{/if}

	{#if view === 'overlay' && image.before && image.after}
		<figure class="side">
			<div class="frame stack">
				<img src={image.before.dataUri} alt="Before" class:small={mapSmall.before} />
				<img
					class="over"
					class:small={mapSmall.after}
					src={image.after.dataUri}
					alt="After"
					style:opacity={mix / 100}
				/>
			</div>
			<label class="mix">
				<span>Before</span>
				<input
					type="range"
					min="0"
					max="100"
					bind:value={mix}
					aria-label="Show the new image over the old"
				/>
				<span>After</span>
			</label>
		</figure>
	{:else}
		<div class="pair">
			{#each [['before', 'Before', image.before], ['after', 'After', image.after]] as const as [side, label, data] (side)}
				<figure class="side">
					<figcaption>{label}</figcaption>
					{#if data}
						<div class="frame">
							<img
								src={data.dataUri}
								alt={label}
								class:small={mapSmall[side]}
								onload={(event) => measured(side, event)}
							/>
						</div>
						<span class="meta"
							>{mapSize[side]}{mapSize[side] ? ' · ' : ''}{formatBytes(data.bytes)}</span
						>
					{:else}
						<div class="frame missing">
							{side === 'before' ? 'Not there before this change' : 'Removed by this change'}
						</div>
					{/if}
				</figure>
			{/each}
		</div>
	{/if}
</div>

<style>
	.images {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-3);
		min-height: 0;
		padding: var(--gg-space-3);
		overflow: auto;
	}
	.views {
		display: inline-flex;
		align-self: flex-start;
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		overflow: hidden;
	}
	.views button {
		padding: 1px var(--gg-space-3);
		font: inherit;
		color: var(--gg-fg-muted);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.views button.on {
		color: var(--gg-btn-fg);
		background: var(--gg-btn-bg);
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--gg-space-3);
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		margin: 0;
		min-width: 0;
	}
	figcaption {
		font-weight: 600;
	}
	/* A checkerboard under the image, so transparent pixels read as transparent. */
	.frame {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 120px;
		padding: var(--gg-space-2);
		border: 1px solid var(--gg-border);
		background-color: var(--gg-bg);
		background-image:
			linear-gradient(45deg, var(--gg-checker) 25%, transparent 25%),
			linear-gradient(-45deg, var(--gg-checker) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--gg-checker) 75%),
			linear-gradient(-45deg, transparent 75%, var(--gg-checker) 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
		--gg-checker: color-mix(in srgb, var(--gg-fg) 10%, transparent);
	}
	.frame img {
		max-width: 100%;
		max-height: 60vh;
		image-rendering: auto;
	}
	/* Scaled up whole pixels at a time, so a 16 px sprite reads instead of blurring. */
	.frame img.small {
		width: 128px;
		height: auto;
		image-rendering: pixelated;
	}
	.frame.missing {
		color: var(--gg-fg-muted);
		background-image: none;
		font-style: italic;
	}
	.stack {
		display: grid;
	}
	.stack img {
		grid-area: 1 / 1;
		margin: auto;
	}
	.meta {
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
		font-variant-numeric: tabular-nums;
	}
	.mix {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		color: var(--gg-fg-muted);
	}
	.mix input {
		flex: 1;
	}
</style>
