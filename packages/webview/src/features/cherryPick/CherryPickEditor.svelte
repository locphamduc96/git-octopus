<script lang="ts">
	import type { Commit } from '@git-octopus/shared';
	import Modal from '../../lib/ui/Modal.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { cherryPickEditor } from '../../lib/stores/cherryPickEditor.svelte';

	interface Row {
		commit: Commit;
		included: boolean;
	}

	let listRows = $state<Row[]>([]);
	let focused = $state(0);
	let recordOrigin = $state(false);
	let noCommit = $state(false);
	let loadedFrom: typeof cherryPickEditor.current = null;

	// Rebuilt only when a new selection opens the editor, so reordering is not undone by a re-read.
	$effect(() => {
		const current = cherryPickEditor.current;
		if (!current || current === loadedFrom) return;
		loadedFrom = current;
		listRows = current.listCommits.map((commit) => ({ commit, included: true }));
		focused = 0;
	});

	const listPicked = $derived(listRows.filter((row) => row.included));
	const count = $derived(listPicked.length);

	function move(index: number, step: -1 | 1): void {
		const to = index + step;
		if (to < 0 || to >= listRows.length) return;
		const next = [...listRows];
		[next[index], next[to]] = [next[to], next[index]];
		listRows = next;
		focused = to;
	}

	function onRowKey(event: KeyboardEvent, index: number): void {
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			move(index, event.key === 'ArrowUp' ? -1 : 1);
		} else if (event.key === ' ' && event.target === event.currentTarget) {
			event.preventDefault();
			listRows[index].included = !listRows[index].included;
		}
	}

	function start(): void {
		cherryPickEditor.run(
			listPicked.map((row) => row.commit.hash),
			{ recordOrigin, noCommit }
		);
	}

	function when(seconds: number): string {
		return new Date(seconds * 1000).toLocaleDateString();
	}
</script>

{#if cherryPickEditor.current}
	<Modal title="Cherry pick commits" wide onclose={cherryPickEditor.close}>
		{#snippet body()}
			<p class="note">
				Applied top to bottom onto
				{#if cherryPickEditor.current?.target}
					<span class="mono">{cherryPickEditor.current.target}</span>.
				{:else}
					the detached HEAD.
				{/if}
				Space leaves the focused commit out; Alt+↑/↓ move it.
			</p>
			<ol class="rows" role="listbox" aria-label="Commits to cherry pick">
				{#each listRows as row, index (row.commit.hash)}
					<li
						class="row"
						class:skipped={!row.included}
						class:focused={focused === index}
						role="option"
						aria-selected={focused === index}
						tabindex="0"
						onfocus={() => (focused = index)}
						onkeydown={(event) => onRowKey(event, index)}
					>
						<span class="order">
							<IconButton
								name="arrow-up"
								label="Move up"
								disabled={index === 0}
								onclick={() => move(index, -1)}
							/>
							<IconButton
								name="arrow-down"
								label="Move down"
								disabled={index === listRows.length - 1}
								onclick={() => move(index, 1)}
							/>
						</span>
						<input
							type="checkbox"
							bind:checked={listRows[index].included}
							aria-label="Pick {row.commit.subject}"
						/>
						<span class="mono hash">{row.commit.hash.slice(0, 7)}</span>
						<span class="subject" title={row.commit.subject}>{row.commit.subject}</span>
						<span class="meta">{row.commit.author.name} · {when(row.commit.authoredAt)}</span>
					</li>
				{/each}
			</ol>
			<label class="option">
				<input type="checkbox" bind:checked={recordOrigin} />
				<span>Record where each commit came from (<span class="mono">-x</span>)</span>
			</label>
			<label class="option">
				<input type="checkbox" bind:checked={noCommit} />
				<span
					>Stage the changes without committing them (<span class="mono">--no-commit</span>)</span
				>
			</label>
		{/snippet}
		{#snippet actions()}
			<button class="btn" onclick={cherryPickEditor.close}>Cancel</button>
			<button class="btn primary" disabled={count === 0} onclick={start}
				>{noCommit ? 'Apply' : 'Cherry pick'} {count} commit{count === 1 ? '' : 's'}</button
			>
		{/snippet}
	</Modal>
{/if}

<style>
	.note {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	/* One soft block for the whole list; the rows inside part by spacing and hover, not rules. */
	.rows {
		list-style: none;
		margin: 0;
		padding: var(--gg-space-1) 0;
		max-height: 50vh;
		overflow: auto;
		border-radius: var(--gg-radius-lg);
		background: var(--gg-tint);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		min-width: 0;
		padding: 2px var(--gg-space-2);
		outline: none;
	}
	.row.focused {
		box-shadow: inset 2px 0 0 var(--gg-focus);
	}
	.row.skipped .subject,
	.row.skipped .hash,
	.row.skipped .meta {
		text-decoration: line-through;
		opacity: 0.55;
	}
	.order {
		display: inline-flex;
		flex: none;
	}
	.mono {
		font-family: var(--gg-font-mono);
	}
	.hash {
		flex: none;
		color: var(--gg-fg-muted);
	}
	.subject {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	.option {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
	}
	/* Footer buttons, in VS Code's own button colours. */
	.btn {
		padding: 3px var(--gg-space-3);
		font: inherit;
		color: var(--gg-btn2-fg);
		background: var(--gg-btn2-bg);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		cursor: pointer;
	}
	.btn.primary {
		color: var(--gg-btn-fg);
		background: var(--gg-btn-bg);
		border-color: transparent;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
