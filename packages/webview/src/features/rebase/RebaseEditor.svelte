<script lang="ts">
	import type { RebaseStepAction, RebaseTodoCommit } from '@git-octopus/shared';
	import { validateSteps } from '@git-octopus/shared';
	import Modal from '../../lib/ui/Modal.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { rebaseEditor } from '../../lib/stores/rebaseEditor.svelte';

	interface Row {
		commit: RebaseTodoCommit;
		action: RebaseStepAction;
		message: string;
	}

	const LIST_ACTIONS: { id: RebaseStepAction; label: string; key: string; hint: string }[] = [
		{ id: 'pick', label: 'Pick', key: 'p', hint: 'Keep the commit as it is' },
		{ id: 'reword', label: 'Reword', key: 'r', hint: 'Keep it, with a new message' },
		{
			id: 'squash',
			label: 'Squash',
			key: 's',
			hint: 'Fold into the commit above, keeping both messages',
		},
		{
			id: 'fixup',
			label: 'Fixup',
			key: 'f',
			hint: 'Fold into the commit above, dropping this message',
		},
		{ id: 'drop', label: 'Drop', key: 'd', hint: 'Leave the commit out' },
	];

	let listRows = $state<Row[]>([]);
	let loadedFor = '';
	let focused = $state(0);

	// The rows are built once per list the host sends; editing them must not be undone by a re-read.
	$effect(() => {
		const current = rebaseEditor.current;
		const key = `${current?.base}\0${current?.branch ?? ''}`;
		if (!current?.listCommits || loadedFor === key) return;
		loadedFor = key;
		listRows = current.listCommits.map((commit) => ({
			commit,
			action: 'pick',
			message: commit.message,
		}));
	});

	const problem = $derived(listRows.length === 0 ? null : validateSteps(listRows));
	/** Starting a rebase that changes nothing would only rewrite committer dates. */
	const changed = $derived(
		listRows.some(
			(row, index) =>
				row.action !== 'pick' ||
				row.commit.hash !== rebaseEditor.current?.listCommits?.[index]?.hash
		)
	);

	function setAction(index: number, action: RebaseStepAction): void {
		listRows[index].action = action;
	}

	function move(index: number, step: -1 | 1): void {
		const to = index + step;
		if (to < 0 || to >= listRows.length) return;
		const next = [...listRows];
		[next[index], next[to]] = [next[to], next[index]];
		listRows = next;
		focused = to;
	}

	function onRowKey(event: KeyboardEvent, index: number): void {
		if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			move(index, event.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		const action = LIST_ACTIONS.find((item) => item.key === event.key.toLowerCase());
		if (action && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			setAction(index, action.id);
		}
	}

	function start(): void {
		if (problem !== null) return;
		rebaseEditor.run(
			listRows.map((row) => ({
				hash: row.commit.hash,
				action: row.action,
				...(row.action === 'reword' ? { message: row.message } : {}),
			}))
		);
	}
</script>

{#if rebaseEditor.current}
	<Modal
		title={rebaseEditor.current.branch
			? `Interactive rebase ${rebaseEditor.current.branch} onto ${rebaseEditor.current.baseLabel}`
			: 'Interactive rebase'}
		wide
		onclose={rebaseEditor.close}
	>
		{#snippet body()}
			{#if rebaseEditor.current?.error}
				<p class="error">{rebaseEditor.current.error}</p>
			{:else if rebaseEditor.current?.listCommits === null}
				<p class="note">Reading the commits…</p>
			{:else}
				<p class="note">
					Applied top to bottom onto
					<span class="mono">{rebaseEditor.current?.baseLabel}</span>. P / R / S / F / D set the
					step of the focused row; Alt+↑/↓ move it.
				</p>
				<ol class="rows" role="listbox" aria-label="Commits to rewrite">
					{#each listRows as row, index (row.commit.hash)}
						<li
							class="row step-{row.action}"
							class:focused={focused === index}
							role="option"
							aria-selected={focused === index}
							tabindex="0"
							onfocus={() => (focused = index)}
							onkeydown={(event) => onRowKey(event, index)}
						>
							<div class="line">
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
								<span class="actions" role="radiogroup" aria-label="Step for {row.commit.subject}">
									{#each LIST_ACTIONS as item (item.id)}
										<button
											role="radio"
											aria-checked={row.action === item.id}
											class:on={row.action === item.id}
											title="{item.hint} ({item.key.toUpperCase()})"
											onclick={() => setAction(index, item.id)}>{item.label}</button
										>
									{/each}
								</span>
								<span class="mono hash">{row.commit.hash.slice(0, 7)}</span>
								<span class="subject" title={row.commit.message}>{row.commit.subject}</span>
							</div>
							{#if row.action === 'reword'}
								<textarea
									bind:value={listRows[index].message}
									rows="3"
									aria-label="New message for {row.commit.subject}"
								></textarea>
							{/if}
						</li>
					{/each}
				</ol>
				{#if problem}<p class="error">{problem}</p>{/if}
			{/if}
		{/snippet}
		{#snippet actions()}
			<button class="btn" onclick={rebaseEditor.close}>Cancel</button>
			<button
				class="btn primary"
				disabled={!rebaseEditor.current?.listCommits ||
					problem !== null ||
					!changed ||
					!!rebaseEditor.current?.error}
				onclick={start}>Start rebase</button
			>
		{/snippet}
	</Modal>
{/if}

<style>
	.note {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.error {
		margin: 0;
		color: var(--vscode-errorForeground);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 50vh;
		overflow: auto;
		border: 1px solid var(--gg-border);
	}
	.row {
		padding: 2px var(--gg-space-2);
		border-bottom: 1px solid color-mix(in srgb, var(--gg-fg) 8%, transparent);
		outline: none;
	}
	.row.focused {
		box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
	}
	.row.step-drop .subject,
	.row.step-drop .hash {
		text-decoration: line-through;
		opacity: 0.55;
	}
	/* Indented under the commit it folds into, so the result reads before it runs. */
	.row.step-squash,
	.row.step-fixup {
		padding-left: calc(var(--gg-space-2) + 16px);
	}
	.line {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		min-width: 0;
	}
	.order {
		display: inline-flex;
		flex: none;
	}
	.actions {
		display: inline-flex;
		flex: none;
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		overflow: hidden;
	}
	.actions button {
		padding: 0 6px;
		font: inherit;
		font-size: 0.85em;
		line-height: 18px;
		color: var(--gg-fg-muted);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.actions button.on {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.hash {
		flex: none;
		color: var(--gg-fg-muted);
	}
	.subject {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		margin: 4px 0 2px;
		font: inherit;
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
	}
	/* Footer buttons, in VS Code's own button colours. */
	.btn {
		padding: 3px var(--gg-space-3);
		font: inherit;
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		background: var(--vscode-button-secondaryBackground, transparent);
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		cursor: pointer;
	}
	.btn.primary {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border-color: transparent;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
