<script lang="ts">
	/** Section headings and how many file rows each one stands in for, matching `ChangesTab`. */
	const listSections = [
		{ title: 56, rows: 3 },
		{ title: 72, rows: 2 },
		{ title: 108, rows: 4 },
	];
	/** Fixed name widths — a placeholder that reshuffles on every render reads as a broken list. */
	const listNameW = [58, 74, 45, 66, 52, 80, 61, 48, 70];
	const at = <T,>(list: T[], i: number): T => list[i % list.length];
</script>

<div class="skeleton" aria-busy="true" aria-label="Loading changes">
	<div class="toolbar"></div>

	<div class="body">
		{#each listSections as section, s (s)}
			<div class="section">
				<div class="gg-skeleton-bar heading" style="width:{section.title}px"></div>
				{#each { length: section.rows } as _, r (r)}
					<div class="row">
						<span class="gg-skeleton-bar icon"></span>
						<span class="gg-skeleton-bar name" style="width:{at(listNameW, s * 3 + r)}%"></span>
					</div>
				{/each}
			</div>
		{/each}
		<div class="gg-shimmer"></div>
	</div>
</div>

<style>
	.skeleton {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	/*
	 * Stands in for the commit/push strip, so it has to measure the same as one: `box-sizing` is what
	 * keeps the divider inside `--gg-header-h` instead of adding a pixel on top, which is exactly how
	 * far the real toolbar and this one had drifted apart.
	 */
	.toolbar {
		flex: none;
		height: var(--gg-header-h);
		box-sizing: border-box;
		border-bottom: 1px solid var(--gg-border);
	}
	.body {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, #000 70%, transparent 100%);
	}
	.section {
		padding-bottom: var(--gg-space-2);
	}
	.heading {
		height: 8px;
		margin: var(--gg-space-2) var(--gg-space-2) var(--gg-space-1);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		height: 22px;
		padding: 0 var(--gg-space-2) 0 var(--gg-space-4);
	}
	.icon {
		flex: none;
		width: 14px;
		height: 14px;
	}
	.name {
		height: 9px;
	}
</style>
