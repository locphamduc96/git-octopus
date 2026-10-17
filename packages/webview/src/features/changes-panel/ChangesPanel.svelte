<script lang="ts">
	import type {
		CommitDetails,
		FileChange,
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import { fade } from 'svelte/transition';
	import { motionMs } from '../../lib/ui/motion';
	import ChangesSkeleton from './ChangesSkeleton.svelte';
	import AiCommitDialog from './AiCommitDialog.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import ChangesTab from './ChangesTab.svelte';
	import CommitTab from './CommitTab.svelte';
	import CompareTab from './CompareTab.svelte';
	import HistoryTab from './HistoryTab.svelte';
	import {
		UNCOMMITTED_HASH,
		type FileHistoryEntry,
		type WorkingDiffSide,
	} from '@git-octopus/shared';
	import ContextMenu from '../../lib/ui/ContextMenu.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import type { FileViewMode } from '../../lib/fileTree';
	import type { PanelMode } from '../../lib/panelFiles';
	import { buildFileMenu, type FileMenuAction, type LocalFileMenuId } from '../../lib/fileMenu';
	import { tooltip } from '../../lib/ui/tooltip';
	import type { CommitOptions } from '../../lib/stores/identity.svelte';

	export interface ComparisonState {
		fromHash: string | null;
		toHash: string | null;
		files: FileChange[];
		loading: boolean;
	}

	let {
		mode,
		loading,
		working,
		details,
		detailsLoading,
		ahead,
		comparison,
		activePath,
		onworkingAction,
		onopenWorkingFile,
		onopenDiff,
		onopenCompareDiff,
		onopenFile,
		onrestoreFile,
		onapplyFromStash,
		history,
		onfileHistory,
		onblame,
		onhistoryOpen,
		onhistoryReveal,
		oncopyPath,
		onpush,
		onpushForce,
		oncopy,
		onselectCommit,
		fileView,
		onfileView,
		onclose,
		metaOpen,
		onmetaOpen,
	}: {
		fileView: FileViewMode;
		onfileView: (mode: FileViewMode) => void;
		onclose: () => void;
		metaOpen: boolean;
		onmetaOpen: (open: boolean) => void;
		mode: PanelMode;
		/** The first load, before the host has said anything about this repository. */
		loading: boolean;
		working: WorkingTreeStatus | null;
		details: CommitDetails | null;
		detailsLoading: boolean;
		ahead: number;
		comparison: ComparisonState;
		/** The file whose diff is open in the panel, highlighted in whichever tab lists it. */
		activePath: string | null;
		onworkingAction: (
			action: WorkingTreeAction,
			path?: string,
			message?: string,
			options?: CommitOptions
		) => void;
		/** Without a side, the part to show is worked out from where the file is listed. */
		onopenWorkingFile: (path: string, side?: WorkingDiffSide) => void;
		onopenDiff: (path: string) => void;
		onopenCompareDiff: (path: string) => void;
		/** Open the file itself: the copy on disk, or its content at `hash`. */
		onopenFile: (path: string, hash?: string) => void;
		/** Put the file back as it was at `hash`, staged. */
		onrestoreFile: (path: string, hash: string) => void;
		/** Bring one file of a stash back into the working tree; `hash` is where its content lives. */
		onapplyFromStash: (path: string, hash: string) => void;
		/** The file history on show in `history` mode, or null. */
		history: {
			path: string;
			listEntries: FileHistoryEntry[];
			loading: boolean;
			truncated: boolean;
			error: string | null;
			activeHash: string | null;
		} | null;
		/** Read a file's history from `rev` (a commit) or from HEAD. */
		onfileHistory: (path: string, rev: string | null) => void;
		/** Show a file's blame at `rev`, or in the working tree. */
		onblame: (path: string, rev: string | null) => void;
		onhistoryOpen: (entry: FileHistoryEntry) => void;
		onhistoryReveal: (hash: string) => void;
		oncopyPath: (path: string, absolute: boolean) => void;
		onpush: () => void;
		onpushForce: () => void;
		oncopy: (text: string) => void;
		onselectCommit: (hash: string) => void;
	} = $props();

	const changeCount = $derived(working ? working.staged.length + working.unstaged.length : 0);

	/** Which tab is showing — none of them while the first answer is still on its way. */
	const active = $derived<PanelMode | null>(loading ? null : mode);

	/**
	 * One menu for all three tabs. Each tab hands over the file plus whatever actions its own section
	 * offers, so the panel does not have to work out which list a row came from.
	 */
	let menu = $state<{
		x: number;
		y: number;
		file: FileChange;
		listActions: FileMenuAction[];
	} | null>(null);

	function openMenu(event: MouseEvent, file: FileChange, listActions: FileMenuAction[] = []): void {
		menu = { x: event.clientX, y: event.clientY, file, listActions };
	}

	/** The diff a file opens to depends on what the panel is showing. */
	function openChanges(path: string): void {
		if (mode === 'changes') onopenWorkingFile(path);
		else if (mode === 'commit') onopenDiff(path);
		else onopenCompareDiff(path);
	}

	/**
	 * The cases below are the whole of the menu's own id space, so whatever falls past them is a
	 * working-tree action a section handed over — `default` needs no check of its own to say so.
	 */
	/** The revision the panel's files are shown at: what history and blame read from. */
	function panelRevision(): string | null {
		if (mode === 'commit') return details?.hash ?? null;
		if (mode === 'compare' && comparison.toHash !== UNCOMMITTED_HASH) return comparison.toHash;
		return null;
	}

	function runMenu(id: LocalFileMenuId | WorkingTreeAction): void {
		const file = menu?.file;
		menu = null;
		if (!file) return;
		switch (id) {
			case 'openChanges':
				return openChanges(file.path);
			case 'openFile':
				return onopenFile(file.path);
			case 'openFileAtRev':
				return onopenFile(file.path, file.revision ?? details?.hash);
			case 'restoreFromCommit':
				if (details) onrestoreFile(file.path, details.hash);
				return;
			case 'applyFromStash':
				// A file untracked when stashed lives in the stash's third parent, not the stash itself.
				if (details) onapplyFromStash(file.path, file.revision ?? details.hash);
				return;
			case 'fileHistory':
				return onfileHistory(file.path, panelRevision());
			case 'blame':
				return onblame(file.path, panelRevision());
			case 'copyPath':
				return oncopyPath(file.path, true);
			case 'copyRelativePath':
				return oncopyPath(file.path, false);
			default:
				return onworkingAction(id, file.path);
		}
	}
</script>

<aside class="panel">
	<header>
		<!-- No branch name yet, and "detached" is the wrong thing to guess while still asking. -->
		{#if loading}
			<span class="summary"><span class="gg-skeleton-bar head-bar"></span></span>
		{:else if mode === 'changes'}
			<!-- The branch and its drift are on the control bar and the Push button already; the panel
			     only names what it lists. -->
			<span class="summary">
				<span class="title">Working tree</span>
				{#if changeCount > 0}<span
						class="count"
						use:tooltip={`${changeCount} change${changeCount === 1 ? '' : 's'}`}>{changeCount}</span
					>{/if}
			</span>
		{:else if mode === 'commit'}
			<span class="summary">
				Commit
				{#if details}<span class="mono">{details.hash.slice(0, 8)}</span>{/if}
			</span>
		{:else if mode === 'history'}
			<span class="summary">
				History
				{#if history}<span class="mono">{history.path.split('/').pop()}</span>{/if}
			</span>
		{:else}
			<span class="summary">
				Comparing
				{#if comparison.fromHash && comparison.toHash}
					<span class="mono">
						{comparison.fromHash.slice(0, 8)} ↔ {comparison.toHash === UNCOMMITTED_HASH
							? 'working tree'
							: comparison.toHash.slice(0, 8)}
					</span>
				{/if}
			</span>
		{/if}

		<span class="tools">
			<!-- Expands the commit message in the tab below; lives up here with the other view controls
			     rather than dangling off the end of the subject line. -->
			{#if mode === 'commit'}
				<IconButton
					name={metaOpen ? 'fold' : 'unfold'}
					label={metaOpen ? 'Collapse the commit message' : 'Expand the commit message'}
					title={metaOpen ? 'Hide the rest of the message' : 'Show the whole message'}
					onclick={() => onmetaOpen(!metaOpen)}
				/>
			{/if}
			{#if mode !== 'history'}
				<button class:active={fileView === 'list'} onclick={() => onfileView('list')}>
					<Icon name="list-flat" label="File list" />
				</button>
				<button class:active={fileView === 'tree'} onclick={() => onfileView('tree')}>
					<Icon name="list-tree" label="File tree" />
				</button>
			{/if}
			<!-- The working tree is where the panel returns to, so it has nothing to close. -->
			{#if mode !== 'changes'}
				<IconButton
					name="close"
					label="Close"
					title="Close — go back to the working tree"
					onclick={onclose}
				/>
			{/if}
		</span>
	</header>

	<!--
		All three tabs stay mounted and take turns being visible. Swapping them with `{#if}` threw away
		the scroll position and the open folders of the one leaving, and the file lists are virtualised:
		`display: none` reports a height of zero, so the tab coming back would render no rows until it
		had been measured for a frame. Hidden here means invisible, not unlaid-out.
	-->
	<div class="body">
		<div class="slot" class:hidden={active !== 'changes'} inert={active !== 'changes'}>
			<ChangesTab
				{working}
				{ahead}
				{fileView}
				{activePath}
				{onpush}
				{onpushForce}
				onaction={onworkingAction}
				onopenFile={onopenWorkingFile}
				onmenu={openMenu}
			/>
		</div>
		<div class="slot" class:hidden={active !== 'commit'} inert={active !== 'commit'}>
			<CommitTab
				{details}
				loading={detailsLoading}
				{fileView}
				{activePath}
				{metaOpen}
				{onmetaOpen}
				{onopenDiff}
				{oncopy}
				{onselectCommit}
				onmenu={(event, file) => openMenu(event, file)}
			/>
		</div>
		<div class="slot" class:hidden={active !== 'compare'} inert={active !== 'compare'}>
			<CompareTab
				fromHash={comparison.fromHash}
				toHash={comparison.toHash}
				files={comparison.files}
				loading={comparison.loading}
				{fileView}
				{activePath}
				onopenDiff={onopenCompareDiff}
				onmenu={(event, file) => openMenu(event, file)}
			/>
		</div>
		<div class="slot" class:hidden={active !== 'history'} inert={active !== 'history'}>
			{#if history}
				<HistoryTab
					path={history.path}
					listEntries={history.listEntries}
					loading={history.loading}
					truncated={history.truncated}
					error={history.error}
					activeHash={history.activeHash}
					onopen={onhistoryOpen}
					onreveal={onhistoryReveal}
				/>
			{/if}
		</div>
		{#if loading}
			<!-- Safe to fade on the way out here, unlike the graph's: the slots are stacked on top of
			     each other, so the one leaving costs the one arriving no room. -->
			<div class="slot" out:fade={{ duration: motionMs('fast') }}><ChangesSkeleton /></div>
		{/if}
	</div>
</aside>

<!-- Outside the tab slots: a hidden slot is `visibility: hidden` + `inert`, and the dialog must
     float over whichever tab is showing, not vanish with the one that opened it. -->
{#if aiCommit.open}
	<AiCommitDialog />
{/if}

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		items={buildFileMenu({
			listActions: menu.listActions,
			atRevision: mode === 'commit' && details !== null,
			deleted: menu.file.status === 'D',
			untracked: menu.file.status === '?',
			stash: mode === 'commit' && details?.stash === true,
		})}
		onselect={runMenu}
		onclose={() => (menu = null)}
	/>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		min-width: 0;
		border-left: 1px solid var(--gg-seam);
		background: var(--gg-bg-raised);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		height: var(--gg-header-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		border-bottom: 1px solid var(--gg-seam);
		color: var(--gg-fg-muted);
		white-space: nowrap;
		overflow: hidden;
	}
	.summary {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title {
		color: var(--gg-fg);
		font-weight: 600;
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 16px;
		margin-left: var(--gg-space-1);
		padding: 0 5px;
		box-sizing: border-box;
		border-radius: 999px;
		background: var(--gg-badge-bg);
		color: var(--gg-badge-fg);
		font-size: var(--gg-text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		vertical-align: 1px;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 1px;
		margin-left: auto;
		flex: none;
	}
	/* The list/tree pair is a segmented control, so it keeps its own `active` state — but the same
	   square as every other icon control, or the header row stops sitting on one line. */
	.tools button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--gg-hit);
		height: var(--gg-hit);
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: var(--gg-radius);
		cursor: pointer;
		padding: 0;
	}
	.tools button:hover {
		background: var(--gg-bg-tool-hover);
	}
	.tools button.active {
		background: var(--gg-bg-tool-active);
	}
	.mono {
		font-family: var(--gg-font-mono);
	}
	.body {
		position: relative;
		flex: 1;
		min-height: 0;
		/* The hidden tabs sit 3px low for the crossfade below; unclipped, those 3px poke past the
		   panel and hand the whole webview body a scrollbar. */
		overflow: hidden;
	}
	/*
	 * Tabs cross over rather than cut: the one arriving rises the last few pixels into place while
	 * the one leaving drops away. `visibility` is what keeps a hidden tab out of the way of clicks
	 * and the Tab key, so it flips only once the fade is over — hence the delay on that one property.
	 */
	.slot {
		position: absolute;
		inset: 0;
		transition:
			opacity var(--gg-motion-fast) var(--gg-ease),
			transform var(--gg-motion-fast) var(--gg-ease);
	}
	.slot.hidden {
		opacity: 0;
		transform: translateY(3px);
		visibility: hidden;
		transition:
			opacity var(--gg-motion-fast) var(--gg-ease),
			transform var(--gg-motion-fast) var(--gg-ease),
			visibility 0s var(--gg-motion-fast);
	}
	.head-bar {
		display: inline-block;
		width: 90px;
		height: 9px;
	}
</style>
