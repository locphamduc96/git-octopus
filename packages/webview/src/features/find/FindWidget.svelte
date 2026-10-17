<script lang="ts">
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		query,
		matchCount,
		currentIndex,
		error,
		partial,
		matchCase,
		regex,
		filter,
		onquery,
		onstep,
		onmatchCase,
		onregex,
		onfilter,
		onclose,
	}: {
		query: string;
		matchCount: number;
		/** 0-based position of the current match, or -1 when none is current yet. */
		currentIndex: number;
		/** Why the query cannot run (an unfinished regex), shown in place of the count. */
		error: string | null;
		/** More history exists than is loaded, so the count covers the loaded commits only. */
		partial: boolean;
		matchCase: boolean;
		regex: boolean;
		/** Hide the commits that do not match instead of highlighting the ones that do. */
		filter: boolean;
		onquery: (query: string) => void;
		onstep: (step: 1 | -1) => void;
		onmatchCase: () => void;
		onregex: () => void;
		onfilter: () => void;
		onclose: () => void;
	} = $props();

	const countText = $derived.by(() => {
		if (query.trim() === '') return '';
		if (error !== null) return error;
		if (matchCount === 0) return 'No matches';
		if (currentIndex >= 0) return `${currentIndex + 1}/${matchCount}`;
		return `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
	});
</script>

<div class="find">
	<!-- svelte-ignore a11y_autofocus -->
	<input
		autofocus
		value={query}
		placeholder="Find commits…"
		aria-label="Find commits"
		oninput={(event) => onquery(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === 'Escape') onclose();
			else if (event.key === 'Enter' || event.key === 'F3') {
				event.preventDefault();
				onstep(event.shiftKey ? -1 : 1);
			}
		}}
	/>
	<IconButton name="case-sensitive" label="Match case" pressed={matchCase} onclick={onmatchCase} />
	<IconButton name="regex" label="Use regular expression" pressed={regex} onclick={onregex} />
	<IconButton
		name="filter"
		label="Show only matching commits"
		title="Show only matching commits — off highlights them in the full graph"
		pressed={filter}
		onclick={onfilter}
	/>
	<span
		class="count"
		class:error={error !== null && query.trim() !== ''}
		use:tooltip={partial ? 'Counted in the commits loaded so far' : ''}>{countText}</span
	>
	<IconButton
		name="arrow-up"
		label="Previous match"
		title="Previous match (Shift+Enter)"
		disabled={matchCount === 0}
		onclick={() => onstep(-1)}
	/>
	<IconButton
		name="arrow-down"
		label="Next match"
		title="Next match (Enter)"
		disabled={matchCount === 0}
		onclick={() => onstep(1)}
	/>
	<IconButton name="close" label="Close find" title="Close (Esc)" onclick={onclose} />
</div>

<style>
	.find {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		background: var(--gg-bg-overlay);
	}
	input {
		flex: 1;
		min-width: 0;
		margin-right: var(--gg-space-1);
		background: var(--gg-input-bg);
		color: var(--gg-input-fg);
		border: 1px solid var(--gg-focus);
		border-radius: var(--gg-radius);
		font: inherit;
		padding: 1px var(--gg-space-2);
	}
	.count {
		flex: none;
		min-width: 6em;
		text-align: center;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
		white-space: nowrap;
	}
	.count.error {
		color: var(--gg-danger);
	}
</style>
