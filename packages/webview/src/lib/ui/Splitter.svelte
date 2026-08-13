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
	.splitter {
		flex: none;
		width: 4px;
		cursor: col-resize;
		background: transparent;
		border: none;
		padding: 0;
	}
	.splitter.vertical {
		width: auto;
		height: 4px;
		cursor: row-resize;
	}
	.splitter:hover,
	.splitter.dragging {
		background: var(--gg-accent);
	}
</style>
