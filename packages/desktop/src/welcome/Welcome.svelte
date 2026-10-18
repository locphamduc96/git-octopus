<script lang="ts">
	import type { WelcomeApi, WelcomeState } from './api';
	import { applyTheme, carriesFiles, droppedFiles } from './dom';

	const api = (globalThis as { gitOctopusWelcome?: WelcomeApi }).gitOctopusWelcome;

	let welcome = $state<WelcomeState>({ listRecent: [], theme: 'dark' });
	api?.onState((next) => {
		welcome = next;
		applyTheme(next.theme);
	});

	let dropping = $state(false);
	let dragDepth = 0;

	const nameOf = (folder: string): string => folder.split('/').filter(Boolean).at(-1) ?? folder;
	const parentOf = (folder: string): string => folder.slice(0, folder.lastIndexOf('/')) || '/';

	function drop(event: Parameters<typeof droppedFiles>[0]): void {
		event.preventDefault();
		dragDepth = 0;
		dropping = false;
		for (const file of droppedFiles(event)) api?.openDropped(file);
	}
</script>

<main
	class="welcome"
	class:dropping
	ondragenter={(event) => {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		dragDepth++;
		dropping = true;
	}}
	ondragover={(event) => {
		if (carriesFiles(event)) event.preventDefault();
	}}
	ondragleave={() => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dropping = false;
	}}
	ondrop={drop}
	aria-label="Welcome"
>
	<div class="column">
		<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="4.5" cy="3.5" r="1.6" />
			<circle cx="4.5" cy="12.5" r="1.6" />
			<circle cx="11.5" cy="5.5" r="1.6" />
			<path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.2 3.2-5.5 3.9" />
		</svg>
		<h1>Git Octopus</h1>
		<p class="lead">Open a repository to see its graph.</p>

		<button class="open" onclick={() => api?.openDialog()}>Open Repository…</button>
		<p class="hint">or drop a folder anywhere on this page</p>

		<section class="recent" aria-label="Recent repositories">
			<h2>Recent</h2>
			{#if welcome.listRecent.length === 0}
				<p class="empty">No recent repositories yet.</p>
			{:else}
				<ul>
					{#each welcome.listRecent as folder (folder)}
						<li class="item">
							<button
								class="entry"
								title={folder}
								aria-label="Open {nameOf(folder)}"
								onclick={() => api?.openRecent(folder)}
							>
								<span class="name">{nameOf(folder)}</span>
								<span class="path">{parentOf(folder)}</span>
							</button>
							<button
								class="square remove"
								aria-label="Remove {nameOf(folder)} from recent"
								title="Remove from recent"
								onclick={() => api?.removeRecent(folder)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true"
									><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg
								>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
	{#if dropping}
		<div class="drop-veil"><span>Drop a folder to open it</span></div>
	{/if}
</main>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
		overflow: hidden;
		user-select: none;
		background: var(--vscode-editor-background);
	}
	:global(#welcome) {
		height: 100%;
	}
	.welcome {
		position: relative;
		display: flex;
		justify-content: center;
		height: 100%;
		box-sizing: border-box;
		padding: 56px 24px 24px;
		overflow-y: auto;
		color: var(--vscode-foreground);
		font-family: var(--vscode-font-family);
		font-size: 13px;
	}
	.column {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: 100%;
		max-width: 520px;
	}
	.mark {
		align-self: center;
		width: 44px;
		height: 44px;
		fill: none;
		stroke: var(--vscode-focusBorder);
		stroke-width: 1.2;
	}
	.mark circle {
		fill: var(--vscode-focusBorder);
		stroke: none;
	}
	h1 {
		margin: 12px 0 4px;
		text-align: center;
		font-size: 22px;
		font-weight: 600;
	}
	.lead,
	.hint,
	.empty {
		margin: 0;
		text-align: center;
		color: var(--vscode-descriptionForeground);
	}
	.lead {
		margin-bottom: 20px;
	}
	.hint {
		margin-top: 8px;
		font-size: 12px;
	}
	.open {
		align-self: center;
		padding: 6px 16px;
		border: none;
		border-radius: 4px;
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		font: inherit;
		cursor: pointer;
	}
	.open:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.open:focus-visible,
	.entry:focus-visible,
	.square:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 1px;
	}
	.recent {
		margin-top: 36px;
	}
	h2 {
		margin: 0 0 6px;
		padding: 0 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 5px;
	}
	.item:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.entry {
		flex: 1 1 auto;
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		padding: 7px 8px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.name {
		flex: none;
		font-weight: 600;
		color: var(--vscode-textLink-foreground);
	}
	.path {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
	}
	.square {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		opacity: 0;
	}
	.square svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.item:hover .square,
	.square:focus-visible {
		opacity: 1;
	}
	.square:hover {
		background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
		color: var(--vscode-foreground);
	}
	.empty {
		padding: 8px;
		text-align: left;
	}
	.drop-veil {
		position: absolute;
		inset: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed var(--vscode-focusBorder);
		border-radius: 10px;
		background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
		font-size: 15px;
		pointer-events: none;
	}
</style>
