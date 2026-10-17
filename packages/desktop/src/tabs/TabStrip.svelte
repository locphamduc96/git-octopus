<script lang="ts">
	import type { TabsApi, TabsState } from '../ipc';

	const api = (globalThis as { gitOctopusTabs?: TabsApi }).gitOctopusTabs;

	let tabs = $state<TabsState>({ listTabs: [], activeId: null, theme: 'dark' });
	api?.onState((next) => {
		tabs = next;
		document.documentElement.dataset.theme = next.theme;
	});

	/** The tab being dragged, and the slot it would land in: an index into the list as it stands. */
	let dragged = $state<number | null>(null);
	let dropAt = $state<number | null>(null);

	function slotFor(event: DragEvent, index: number): number {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return event.clientX < box.left + box.width / 2 ? index : index + 1;
	}

	function drop(): void {
		if (dragged === null || dropAt === null) return;
		const from = tabs.listTabs.findIndex((tab) => tab.id === dragged);
		// Leaving its own slot shifts every later one down by one.
		const to = dropAt > from ? dropAt - 1 : dropAt;
		if (from !== -1 && to !== from) api?.move(dragged, to);
		dragged = null;
		dropAt = null;
	}
</script>

<div class="strip" role="tablist" aria-label="Open repositories">
	<div class="list">
		{#each tabs.listTabs as tab, index (tab.id)}
			<div
				class="tab"
				class:active={tab.id === tabs.activeId}
				class:drop-before={dropAt === index && dragged !== tab.id}
				class:drop-after={dropAt === index + 1 && index === tabs.listTabs.length - 1}
				role="tab"
				tabindex="0"
				aria-selected={tab.id === tabs.activeId}
				title={tab.folder}
				draggable="true"
				onclick={() => api?.select(tab.id)}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') api?.select(tab.id);
				}}
				onauxclick={(event) => {
					if (event.button === 1) api?.close(tab.id);
				}}
				ondragstart={(event) => {
					dragged = tab.id;
					event.dataTransfer?.setData('text/plain', String(tab.id));
				}}
				ondragover={(event) => {
					if (dragged === null) return;
					event.preventDefault();
					dropAt = slotFor(event, index);
				}}
				ondrop={(event) => {
					event.preventDefault();
					drop();
				}}
				ondragend={() => {
					dragged = null;
					dropAt = null;
				}}
			>
				<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="4.5" cy="3.5" r="1.6" />
					<circle cx="4.5" cy="12.5" r="1.6" />
					<circle cx="11.5" cy="5.5" r="1.6" />
					<path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.2 3.2-5.5 3.9" />
				</svg>
				<span class="name">{tab.title}</span>
				{#if tab.branch}<span class="branch">{tab.branch}</span>{/if}
				{#if tab.changeCount > 0}
					<span
						class="badge"
						title="{tab.changeCount} changed file{tab.changeCount === 1 ? '' : 's'}"
						>{tab.changeCount}</span
					>
				{/if}
				<button
					class="square close"
					aria-label="Close {tab.title}"
					title="Close tab (⌘W)"
					onclick={(event) => {
						event.stopPropagation();
						api?.close(tab.id);
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
				</button>
			</div>
		{/each}
	</div>
	<button
		class="square add"
		aria-label="Open a repository in a new tab"
		title="Open a repository in a new tab (⌘T)"
		onclick={() => api?.add()}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
	</button>
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
		overflow: hidden;
		user-select: none;
		background: var(--strip-bg);
	}
	/* Darker than the views below, so the tab in front reads as part of the page it opens onto. */
	:global(:root) {
		--strip-bg: color-mix(in srgb, var(--vscode-editor-background) 62%, #000);
	}
	:global(:root[data-theme='light']) {
		--strip-bg: color-mix(in srgb, var(--vscode-editor-background) 88%, #000);
	}
	.strip {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 100%;
		box-sizing: border-box;
		/* Room for the window's own close / minimise / zoom buttons, drawn over this corner. */
		padding: 0 10px 0 78px;
		border-bottom: 1px solid var(--vscode-panel-border);
		font-family: var(--vscode-font-family);
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
		/* The strip is the title bar: dragged anywhere but a tab or a button, it moves the window. */
		-webkit-app-region: drag;
	}
	.list {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		-webkit-app-region: no-drag;
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 0 1 220px;
		min-width: 110px;
		height: 30px;
		box-sizing: border-box;
		padding: 0 4px 0 10px;
		border-radius: 7px 7px 0 0;
		cursor: default;
		transition: background-color 80ms ease-out;
	}
	.tab:hover:not(.active) {
		background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
	}
	.tab.active {
		background: var(--vscode-editor-background);
		color: var(--vscode-foreground);
		box-shadow: inset 0 2px 0 var(--vscode-focusBorder);
	}
	.tab:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.tab.drop-before::before,
	.tab.drop-after::after {
		content: '';
		position: absolute;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--vscode-focusBorder);
	}
	.tab.drop-before::before {
		left: -2px;
	}
	.tab.drop-after::after {
		right: -2px;
	}
	.glyph {
		flex: none;
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.3;
		opacity: 0.8;
	}
	.glyph circle {
		fill: currentColor;
		stroke: none;
	}
	.name {
		flex: 0 1 auto;
		min-width: 3em;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	/* Gives way first when the tab narrows: the repository's name is what tells tabs apart. */
	.branch {
		flex: 0 4 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.75;
	}
	.badge {
		flex: none;
		display: inline-flex;
		align-items: center;
		height: 16px;
		padding: 0 5px;
		border-radius: 8px;
		font-size: 10px;
		font-weight: 600;
		color: var(--vscode-badge-foreground);
		background: var(--vscode-badge-background);
	}
	.square {
		-webkit-app-region: no-drag;
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: none;
		color: inherit;
		cursor: default;
	}
	.square svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.square:hover {
		background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
	}
	.close {
		width: 20px;
		height: 20px;
		margin-left: auto;
		opacity: 0;
	}
	.close svg {
		width: 12px;
		height: 12px;
	}
	.tab:hover .close,
	.tab.active .close {
		opacity: 1;
	}
	.add {
		width: 26px;
		height: 26px;
		margin-bottom: 2px;
	}
	.add svg {
		width: 14px;
		height: 14px;
	}
</style>
