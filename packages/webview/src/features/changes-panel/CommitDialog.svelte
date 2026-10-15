<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from '../../lib/ui/Modal.svelte';
	import type { CommitDraft } from '../../lib/stores/commitDraft.svelte';
	import type { CommitOptions } from '../../lib/stores/identity.svelte';
	import { COMMIT_TYPES, formatSubject, parseSubject, typeColour } from '../../lib/commitSubject';

	let {
		stagedCount,
		template = null,
		pushAfter = false,
		onpushAfter = () => {},
		draft = null,
		ondraft = () => {},
		oncommit,
		oncancel,
	}: {
		stagedCount: number;
		/** The repository's commit template; undefined while it is being read. */
		template?: string | null;
		/** Push once the commit lands — remembered across commits, so it is the caller's to keep. */
		pushAfter?: boolean;
		onpushAfter?: (value: boolean) => void;
		/** What was typed before a commit the host refused — it fills the dialog instead of the template. */
		draft?: CommitDraft | null;
		/** Hands over what is being committed, so a refused commit can come back with it. */
		ondraft?: (draft: CommitDraft) => void;
		oncommit: (message: string, amend: boolean, options: CommitOptions) => void;
		oncancel: () => void;
	} = $props();

	// Read once: the dialog starts from the draft, and typing must not be undone by a later one.
	const initial = untrack(() => draft);
	let summary = $state(initial?.summary ?? '');
	let description = $state(initial?.description ?? '');
	let amend = $state(initial?.amend ?? false);
	/** Skipping hooks is for this commit only — never a standing choice. */
	let noVerify = $state(initial?.noVerify ?? false);
	// A draft is the user's own words; the template only ever fills an empty dialog.
	let templateApplied = initial !== null;

	// The template arrives after the dialog opens; it only fills boxes nobody has typed in yet.
	$effect(() => {
		if (templateApplied || !template) return;
		templateApplied = true;
		if (summary !== '' || description !== '') return;
		const [first = '', ...listRest] = template.split('\n');
		summary = first;
		description = listRest.join('\n').replace(/^\n+/, '');
	});

	// An amend with no message keeps the previous one, so the summary may stay empty.
	const canCommit = $derived(amend || summary.trim() !== '');
	const parsed = $derived(parseSubject(summary));

	/**
	 * Set or clear the conventional-commit type, keeping any `[ticket]` in front of it.
	 * Clicking the type that is already applied removes it again.
	 */
	function applyType(type: string): void {
		summary = formatSubject({ ...parsed, type: parsed.type === type ? null : type });
	}

	/** Git convention: subject, blank line, then the body. */
	function submit(): void {
		if (!canCommit) return;
		const body = description.trim();
		const subject = summary.trim();
		const message = body === '' || subject === '' ? subject : `${subject}\n\n${body}`;
		ondraft({ summary, description, amend, noVerify });
		oncommit(message, amend, { noVerify, pushAfter: !amend && pushAfter });
	}
</script>

<Modal title="Commit {stagedCount} staged file{stagedCount === 1 ? '' : 's'}" onclose={oncancel}>
	{#snippet body()}
		<label>
			Summary
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				bind:value={summary}
				placeholder="Short description of the change"
				onkeydown={(event) => {
					if (event.key === 'Enter') submit();
				}}
			/>
		</label>

		<div class="types">
			{#each COMMIT_TYPES as type (type)}
				<button
					class="type"
					class:on={parsed.type === type}
					style="--type-colour:{typeColour(type)}"
					onclick={() => applyType(type)}
				>
					{type}
				</button>
			{/each}
		</div>

		<label>
			Description <span class="optional">(optional)</span>
			<textarea bind:value={description} rows="6" placeholder="Why the change was made"></textarea>
		</label>
		<label class="amend">
			<input
				type="checkbox"
				checked={pushAfter && !amend}
				disabled={amend}
				onchange={(event) => onpushAfter(event.currentTarget.checked)}
			/>
			Push after committing{amend ? ' — not with an amend, which would need a force push' : ''}
		</label>
		<label class="amend">
			<input type="checkbox" bind:checked={noVerify} />
			Skip Git hooks for this commit (<code>--no-verify</code>)
		</label>
		<label class="amend">
			<input type="checkbox" bind:checked={amend} />
			Amend the last commit — fold the staged files into it{amend && summary.trim() === ''
				? ' (message kept as is)'
				: ''}
		</label>
		<p class="hint">
			Optional: pick a type above, or write any subject. A leading <code>[TICKET]</code> is kept in front.
			Ctrl/Cmd + Enter commits.
		</p>
	{/snippet}
	{#snippet actions()}
		<button class="confirm" disabled={!canCommit} onclick={submit}>
			{amend ? 'Amend' : 'Commit'}
		</button>
		<button class="cancel" onclick={oncancel}>Cancel</button>
	{/snippet}
</Modal>

<svelte:window
	onkeydown={(event) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit();
	}}
/>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.optional {
		opacity: 0.7;
	}
	input,
	textarea {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: var(--gg-space-1) var(--gg-space-2);
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: 1px solid var(--vscode-focusBorder);
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gg-space-1);
	}
	/* Same shape as the type chips drawn on the graph, so a picked type looks like its result. */
	.type {
		padding: 2px 10px;
		border: 1px solid var(--type-colour);
		border-radius: 3px;
		background: transparent;
		color: var(--type-colour);
		font-size: 0.95em;
		font-weight: 600;
		cursor: pointer;
	}
	.type:hover {
		background: color-mix(in srgb, var(--type-colour) 18%, transparent);
	}
	.type.on {
		background: var(--type-colour);
		color: var(--vscode-editor-background);
	}
	.amend {
		flex-direction: row;
		align-items: center;
		gap: var(--gg-space-2);
		cursor: pointer;
	}
	.hint {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.8em;
	}
	code {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	button {
		border: none;
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-4);
	}
	.confirm {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.confirm:hover:not(:disabled) {
		background: var(--vscode-button-hoverBackground);
	}
	.confirm:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cancel {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
	}
</style>
