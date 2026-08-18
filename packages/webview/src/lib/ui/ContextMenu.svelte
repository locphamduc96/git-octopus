<script lang="ts">
	export interface MenuItem {
		id: string;
		label: string;
		separatorBefore?: boolean;
		/** Shown greyed out and never fires — for actions the current state rules out. */
		disabled?: boolean;
		/** Marks a toggle that is currently on; the tick is drawn against the menu's right edge. */
		checked?: boolean;
		/** Opens as a flyout instead of firing; only the leaves report a selection. */
		children?: MenuItem[];
	}

	let {
		x,
		y,
		items,
		onselect,
		onclose,
	}: {
		x: number;
		y: number;
		items: MenuItem[];
		onselect: (id: string) => void;
		onclose: () => void;
	} = $props();

	/** The submenu currently open, and which side of its parent it had room to open on. */
	let openId = $state<string | null>(null);
	let flip = $state(false);

	/** A submenu needs about this much room to the right before it has to open leftwards instead. */
	const SUBMENU_W = 240;

	function openSubmenu(id: string, event: MouseEvent): void {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		flip = rect.right + SUBMENU_W > window.innerWidth;
		openId = id;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<button
	class="backdrop"
	onclick={onclose}
	oncontextmenu={(e) => e.preventDefault()}
	aria-label="Close menu"
></button>
<ul class="menu" style="left:{x}px; top:{y}px">
	{#each items as item, index (item.id)}
		<!-- A separator before the first item would be a rule with nothing above it: the flag says
		     "start a group here", and the menu edge already does that. -->
		{#if item.separatorBefore && index > 0}
			<li class="sep" role="separator"></li>
		{/if}
		<li
			class:parent={item.children !== undefined}
			onmouseenter={(event) => {
				if (item.children) openSubmenu(item.id, event);
				else openId = null;
			}}
		>
			<button
				class:disabled={item.disabled}
				onclick={() => (item.children || item.disabled ? undefined : onselect(item.id))}
			>
				{item.label}
				{#if item.children}<span class="chevron">›</span>{/if}
				{#if item.checked}<span class="check">✓</span>{/if}
			</button>
			{#if item.children && openId === item.id}
				<ul class="menu submenu" class:flip>
					{#each item.children as child, childIndex (child.id)}
						{#if child.separatorBefore && childIndex > 0}
							<li class="sep" role="separator"></li>
						{/if}
						<li>
							<button
								class:disabled={child.disabled}
								onclick={() => (child.disabled ? undefined : onselect(child.id))}
							>
								{child.label}
								{#if child.checked}<span class="check">✓</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		padding: 0;
		z-index: 10;
		cursor: default;
	}
	.menu {
		position: fixed;
		z-index: 11;
		margin: 0;
		padding: var(--gg-space-1);
		list-style: none;
		min-width: 200px;
		background: var(--vscode-menu-background, var(--gg-bg));
		color: var(--vscode-menu-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-menu-border, var(--gg-border));
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
	}
	.menu li {
		position: relative;
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-3);
		border-radius: var(--gg-radius-item);
	}
	.menu button.disabled {
		opacity: 0.45;
		cursor: default;
	}
	.menu button.disabled:hover {
		background: none;
		color: inherit;
	}
	.menu button:hover,
	.parent:hover > button {
		background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
		color: var(--vscode-menu-selectionForeground, inherit);
	}
	.chevron {
		margin-left: auto;
		opacity: 0.7;
	}
	/* Pushed to the right edge, so a column of toggles reads down its ticks rather than its labels. */
	.check {
		margin-left: auto;
		opacity: 0.8;
	}
	/* Overlaps the parent by a pixel so the pointer never crosses a gap on its way over. */
	.submenu {
		position: absolute;
		left: calc(100% - 1px);
		top: calc(var(--gg-space-1) * -1);
	}
	.submenu.flip {
		left: auto;
		right: calc(100% - 1px);
	}
	.sep {
		height: 1px;
		margin: var(--gg-space-1) 0;
		background: var(--gg-border);
	}
</style>
