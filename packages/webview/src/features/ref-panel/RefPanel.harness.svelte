<script lang="ts">
	/**
	 * Test-only stand-in for the parent that owns the collapsed list: it hands the list back as a
	 * prop after every change, the way the persisted view state will.
	 */
	import type { HiddenRefs, RepoInfo, WorktreeInfo } from '@git-octopus/shared';
	import RefPanel from './RefPanel.svelte';
	import type { RefPanelData, RefPanelItem } from './refPanelModel';

	let {
		data,
		listWorktrees,
		listSubmodules,
		hidden,
		listInitialCollapsed = [],
		onchange,
		onselect,
		onactivate,
		oncontextmenu,
		ondragstart,
		ontogglehidden,
	}: {
		data: RefPanelData;
		listWorktrees: WorktreeInfo[];
		listSubmodules: RepoInfo[];
		hidden: HiddenRefs;
		listInitialCollapsed?: string[];
		onchange: (listCollapsed: string[]) => void;
		onselect: (item: RefPanelItem) => void;
		onactivate: (item: RefPanelItem) => void;
		oncontextmenu: (item: RefPanelItem, event: MouseEvent) => void;
		ondragstart: (item: RefPanelItem, event: DragEvent) => void;
		ontogglehidden: (item: RefPanelItem) => void;
	} = $props();

	// The prop seeds the state once, by design — later values come from the panel's own changes.
	// svelte-ignore state_referenced_locally
	let listCollapsed = $state(listInitialCollapsed);
</script>

<RefPanel
	{data}
	{listWorktrees}
	{listSubmodules}
	{hidden}
	{listCollapsed}
	oncollapsechange={(next) => {
		listCollapsed = next;
		onchange(next);
	}}
	{onselect}
	{onactivate}
	{oncontextmenu}
	{ondragstart}
	{ontogglehidden}
/>
