<script lang="ts">
	import { untrack } from 'svelte';
	import type { BranchCleanupOutcome, BranchInventoryEntry } from '@git-octopus/shared';
	import Modal from '../../lib/ui/Modal.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import {
		buildCleanupRows,
		defaultSelection,
		LIST_MONTH_PRESETS,
		needsForce,
	} from '../../lib/branchCleanup';

	let {
		listBranches,
		mergedBase,
		loading,
		listResults,
		ondelete,
		onclose,
	}: {
		listBranches: BranchInventoryEntry[];
		mergedBase: string | null;
		loading: boolean;
		/** Set once a delete has run; the dialog then shows what happened instead of the picker. */
		listResults: BranchCleanupOutcome[] | null;
		ondelete: (listNames: string[], force: boolean) => void;
		onclose: () => void;
	} = $props();

	let months = $state(6);
	let confirming = $state(false);
	let setSelected = $state(new Set<string>());
	/** Thresholds the user has already seen, so re-picking one does not undo their ticking. */
	let setTouched = $state(new Set<string>());

	const now = new Date();
	const listRows = $derived(buildCleanupRows(listBranches, { now, months }));
	const listSelectable = $derived(listRows.filter((row) => row.selectable));
	const listPicked = $derived(
		listRows.filter((row) => row.selectable && setSelected.has(row.entry.name))
	);
	const force = $derived(needsForce(listRows, setSelected));
	const allPicked = $derived(
		listSelectable.length > 0 && listPicked.length === listSelectable.length
	);

	// A new threshold brings rows the user has never judged, so those get the default ticking while
	// every branch already on screen keeps whatever the user did to it.
	//
	// The rows are the trigger; the two sets are read and written in the same breath, so they are
	// untracked — tracking them would re-run this on its own writes, and on every tick the user
	// makes, for a threshold that has not moved.
	$effect(() => {
		const listCurrent = listRows;
		untrack(() => {
			const listFresh = listCurrent.filter((row) => !setTouched.has(row.entry.name));
			if (listFresh.length === 0) return;
			const setNext = new Set(setSelected);
			for (const name of defaultSelection(listFresh)) setNext.add(name);
			const setNextTouched = new Set(setTouched);
			for (const row of listCurrent) setNextTouched.add(row.entry.name);
			setSelected = setNext;
			setTouched = setNextTouched;
		});
	});

	function toggle(name: string): void {
		const setNext = new Set(setSelected);
		if (!setNext.delete(name)) setNext.add(name);
		setSelected = setNext;
	}

	function toggleAll(): void {
		setSelected = allPicked ? new Set() : new Set(listSelectable.map((row) => row.entry.name));
	}

	function confirmDelete(): void {
		ondelete(
			listPicked.map((row) => row.entry.name),
			force
		);
		confirming = false;
	}

	const title = $derived(listResults ? 'Branch cleanup — results' : 'Clean up branches');
</script>

<Modal {title} {onclose}>
	{#snippet body()}
		{#if listResults}
			{@const failed = listResults.filter((result) => !result.ok)}
			<p class="summary">
				{listResults.length - failed.length} of {listResults.length} deleted.
			</p>
			<ul class="results">
				{#each listResults as result (result.name)}
					<li class:failed={!result.ok}>
						<Icon name={result.ok ? 'check' : 'error'} />
						<span class="name">{result.name}</span>
						{#if result.ok}
							<code class="hash">{result.hash.slice(0, 8)}</code>
						{:else}
							<span class="why">{result.reason}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="hint">
				Deleted by mistake? A branch comes back with <code
					>git branch &lt;name&gt; &lt;hash&gt;</code
				>
				— the hash above is where its tip was.
			</p>
		{:else if loading}
			<p class="summary">Scanning branches…</p>
		{:else}
			<div class="threshold">
				<span class="label">Older than</span>
				{#each LIST_MONTH_PRESETS as preset (preset)}
					<button class="preset" class:active={months === preset} onclick={() => (months = preset)}>
						{preset}mo
					</button>
				{/each}
				<input
					type="number"
					min="0"
					max="240"
					bind:value={months}
					aria-label="Age threshold in months"
				/>
				<span class="label">months</span>
			</div>

			<p class="summary">
				{listRows.length} of {listBranches.length} local branches are older than {months}
				{months === 1 ? 'month' : 'months'}{mergedBase ? `, merged into ${mergedBase}` : ''}.
			</p>

			{#if listRows.length === 0}
				<p class="hint">Nothing to clean up at this threshold.</p>
			{:else}
				<button class="select-all" onclick={toggleAll}>
					{allPicked ? 'Clear selection' : `Select all ${listSelectable.length}`}
				</button>
				<ul class="branches">
					{#each listRows as row (row.entry.name)}
						<li class:locked={!row.selectable}>
							<label>
								<input
									type="checkbox"
									disabled={!row.selectable}
									checked={setSelected.has(row.entry.name)}
									onchange={() => toggle(row.entry.name)}
								/>
								<span class="name">{row.entry.name}</span>
								<span class="age">{row.ageLabel}</span>
							</label>
							<div class="detail">
								<span class="subject">{row.entry.subject}</span>
								{#if row.reason}
									<span class="reason" class:danger={!row.entry.merged && row.selectable}>
										{row.reason}
									</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/snippet}

	{#snippet actions()}
		{#if listResults}
			<span></span>
			<button class="primary" onclick={onclose}>Close</button>
		{:else if confirming}
			<span class="confirm-text">
				Delete {listPicked.length}
				{listPicked.length === 1 ? 'branch' : 'branches'}{force ? ', including unmerged work' : ''}?
			</span>
			<span class="pair">
				<button onclick={() => (confirming = false)}>Cancel</button>
				<button class="danger" onclick={confirmDelete}>
					{force ? 'Force delete' : 'Delete'}
				</button>
			</span>
		{:else}
			<button onclick={onclose}>Cancel</button>
			<button class="danger" disabled={listPicked.length === 0} onclick={() => (confirming = true)}>
				Delete {listPicked.length}
				{listPicked.length === 1 ? 'branch' : 'branches'}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.threshold {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		flex-wrap: wrap;
	}
	.label {
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.summary {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.hint {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		line-height: 1.5;
	}
	input[type='number'] {
		width: 4em;
		background: var(--vscode-input-background, var(--gg-bg));
		color: var(--vscode-input-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 2px var(--gg-space-1);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		/* The list is the part worth scrolling; the threshold row must stay put while it does. */
		max-height: 46vh;
		overflow-y: auto;
	}
	.branches li {
		padding: var(--gg-space-1) 0;
		border-bottom: 1px solid var(--gg-border);
	}
	.branches li:last-child {
		border-bottom: none;
	}
	.branches label {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		cursor: pointer;
	}
	.branches li.locked label {
		cursor: default;
		opacity: 0.6;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.age {
		flex: none;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	.detail {
		display: flex;
		align-items: baseline;
		gap: var(--gg-space-2);
		/* Lines up under the branch name, past the checkbox. */
		padding-left: calc(var(--gg-space-2) + 16px);
		font-size: 0.85em;
		color: var(--gg-fg-muted);
	}
	.subject {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.reason {
		flex: none;
	}
	.reason.danger {
		color: var(--vscode-inputValidation-errorBorder, #c74e39);
	}
	.results li {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: 2px 0;
	}
	.results li.failed .why {
		color: var(--vscode-inputValidation-errorBorder, #c74e39);
		font-size: 0.85em;
	}
	.hash {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.85em;
		color: var(--gg-fg-muted);
	}
	.confirm-text {
		font-size: 0.9em;
	}
	.pair {
		display: flex;
		gap: var(--gg-space-2);
	}
	button {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		font: inherit;
		padding: 3px var(--gg-space-3);
		cursor: pointer;
	}
	button.primary {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	button.danger {
		background: var(--vscode-inputValidation-errorBorder, #c74e39);
		color: #fff;
		border-color: transparent;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.preset {
		padding: 2px var(--gg-space-2);
	}
	button.preset.active {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	button.select-all {
		align-self: flex-start;
		padding: 2px var(--gg-space-2);
		font-size: 0.85em;
	}
</style>
