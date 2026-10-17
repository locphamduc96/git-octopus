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

	/** `indeterminate` is a property with no attribute, so it has to be set on the element itself. */
	function mixed(node: HTMLInputElement, on: boolean) {
		node.indeterminate = on;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			},
		};
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
				<div class="seg" role="group" aria-label="Age presets">
					{#each LIST_MONTH_PRESETS as preset (preset)}
						<button
							class="preset"
							class:active={months === preset}
							aria-pressed={months === preset}
							onclick={() => (months = preset)}
						>
							{preset}mo
						</button>
					{/each}
				</div>
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
				<!-- One box for the whole list, the way a column of checkboxes is ticked everywhere else:
				     it shows the state (none, some, all) as well as changing it. -->
				<label class="select-all">
					<input
						type="checkbox"
						checked={allPicked}
						use:mixed={listPicked.length > 0 && !allPicked}
						disabled={listSelectable.length === 0}
						onchange={toggleAll}
						aria-label="Select all {listSelectable.length}"
					/>
					<span>{listPicked.length} of {listSelectable.length} selected</span>
				</label>
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
										{#if !row.entry.merged && row.selectable}<Icon name="warning" />{/if}
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
		font-size: var(--gg-text-sm);
	}
	.summary {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	.hint {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
		line-height: 1.5;
	}
	input[type='number'] {
		width: 4em;
		background: var(--gg-input-bg);
		color: var(--gg-input-fg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
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
		font-size: var(--gg-text-xs);
	}
	.detail {
		display: flex;
		align-items: baseline;
		gap: var(--gg-space-2);
		/* Lines up under the branch name, past the checkbox. */
		padding-left: calc(var(--gg-space-2) + 16px);
		font-size: var(--gg-text-xs);
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
	/* A word and a mark, not only a colour: the warning has to read without red. */
	.reason.danger {
		display: inline-flex;
		align-items: center;
		gap: var(--gg-space-1);
		color: var(--gg-danger);
	}
	.reason.danger :global(.codicon) {
		font-size: var(--gg-icon-xs);
	}
	.results li {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: 2px 0;
	}
	.results li.failed .why {
		color: var(--gg-danger-border);
		font-size: var(--gg-text-xs);
	}
	.hash {
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
	}
	.confirm-text {
		margin-right: auto;
		font-size: var(--gg-text-sm);
	}
	.pair {
		display: flex;
		gap: var(--gg-space-2);
	}
	button {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		font: inherit;
		padding: 3px var(--gg-space-3);
		cursor: pointer;
	}
	button.primary {
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		border-color: transparent;
	}
	button.danger {
		background: var(--gg-btn-danger-bg);
		color: var(--gg-btn-danger-fg);
		border-color: transparent;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* The presets as one segmented control, the shape every either-or switch in the view takes. */
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--gg-dropdown-border);
		border-radius: var(--gg-radius);
		background: var(--gg-dropdown-bg);
	}
	button.preset {
		padding: 2px var(--gg-space-2);
		border: none;
		border-radius: var(--gg-radius-sm);
		background: transparent;
		color: var(--gg-fg-muted);
	}
	button.preset:hover {
		color: var(--gg-fg);
	}
	button.preset.active {
		background: var(--gg-bg-tool-active);
		color: var(--gg-fg);
	}
	.select-all {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		align-self: flex-start;
		font-size: var(--gg-text-sm);
		font-weight: 600;
		cursor: pointer;
	}
</style>
