<script lang="ts">
	let {
		vertical = false,
		onresize,
	}: {
		/** true = the split stacks vertically, so the divider is horizontal. */
		vertical?: boolean;
		onresize: (clientPos: number) => void;
	} = $props();

	let dragging = $state(false);

	function start(): void {
		dragging = true;
	}

	function move(event: MouseEvent): void {
		if (!dragging) return;
		event.preventDefault();
		onresize(vertical ? event.clientY : event.clientX);
	}
</script>

<svelte:window onmousemove={move} onmouseup={() => (dragging = false)} />

<button
	type="button"
	class="splitter"
	class:vertical
	class:dragging
	aria-label={vertical ? 'Resize panel height' : 'Resize panel width'}
	title="Drag to resize the panel"
	onmousedown={start}
></button>

<style>
	/*
	 * Takes no width of its own: the panes meet on the panel's own border, and a 4px transparent
	 * strip between them read as a gap the content had failed to fill. The grab area is the overlay
	 * below, straddling the seam, so there is still something to aim at.
	 */
	.splitter {
		flex: none;
		position: relative;
		width: 0;
		cursor: col-resize;
		background: transparent;
		border: none;
		padding: 0;
		z-index: 2;
	}
	.splitter.vertical {
		width: auto;
		height: 0;
		cursor: row-resize;
	}
	.splitter::after {
		content: '';
		position: absolute;
		inset: 0 -3px;
	}
	.splitter.vertical::after {
		inset: -3px 0;
	}
	.splitter:hover::after,
	.splitter.dragging::after {
		background: var(--gg-accent);
	}
</style>
