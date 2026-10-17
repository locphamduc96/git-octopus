<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		FileChange,
		WorkingDiffSide,
		WorkingTreeAction,
		WorkingTreeStatus,
	} from '@git-octopus/shared';
	import FileRow, { type FileRowAction } from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import ConfirmDialog from '../../lib/ui/ConfirmDialog.svelte';
	import CommitDialog from './CommitDialog.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import { commitTemplate } from '../../lib/stores/commitTemplate.svelte';
	import { commitDraft } from '../../lib/stores/commitDraft.svelte';
	import { prefs } from '../../lib/stores/prefs.svelte';
	import type { CommitOptions } from '../../lib/stores/identity.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';
	import type { WorkingSection } from '../../lib/viewSettings';
	import type { FileMenuAction } from '../../lib/fileMenu';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		working,
		ahead,
		fileView,
		activePath,
		onaction,
		onopenFile,
		onmenu,
		onpush,
		onpushForce,
	}: {
		working: WorkingTreeStatus | null;
		ahead: number;
		fileView: FileViewMode;
		activePath: string | null;
		/** Right-click on a file; the section's own actions ride along into the menu. */
		onmenu: (event: MouseEvent, file: FileChange, listActions: FileMenuAction[]) => void;
		onaction: (
			action: WorkingTreeAction,
			path?: string,
			message?: string,
			options?: CommitOptions
		) => void;
		/** Open a file's diff: its unstaged part from the upper sections, its staged part from below. */
		onopenFile: (path: string, side: WorkingDiffSide) => void;
		onpush: () => void;
		onpushForce: () => void;
	} = $props();

	type Dialog = 'commit' | 'push' | 'forcePush' | 'undo' | 'aiNoStaged';

	let dialog = $state<Dialog | null>(null);

	const conflicts = $derived(working ? working.unstaged.filter((f) => f.status === 'U') : []);
	const changes = $derived(
		working ? working.unstaged.filter((f) => f.status !== '?' && f.status !== 'U') : []
	);
	const untracked = $derived(working ? working.unstaged.filter((f) => f.status === '?') : []);
	const staged = $derived<FileChange[]>(working ? working.staged : []);

	const listStageActions: FileRowAction<WorkingTreeAction>[] = [
		{ id: 'discard', label: 'Discard changes to this file — cannot be undone', icon: 'discard' },
		{ id: 'stage', label: 'Stage this file for the next commit', icon: 'add' },
	];
	const listUnstageActions: FileRowAction<WorkingTreeAction>[] = [
		{
			id: 'unstage',
			label: 'Unstage this file — keep the change, drop it from the commit',
			icon: 'remove',
		},
	];
	// The hover buttons carry a full explanation as their tooltip; a menu row needs a short label.
	const listStageMenu: FileMenuAction[] = [
		{ id: 'stage', label: 'Stage' },
		{ id: 'discard', label: 'Discard Changes' },
		{ id: 'stashFile', label: 'Stash This File…' },
	];
	// Conflicted: resolving comes first; staging is how a file resolved by hand is marked done.
	const listConflictMenu: FileMenuAction[] = [
		{ id: 'openMergeEditor', label: 'Open in Merge Editor' },
		{ id: 'takeOurs', label: 'Take Current (--ours; the base while rebasing)' },
		{ id: 'takeTheirs', label: 'Take Incoming (--theirs; your commit while rebasing)' },
		{ id: 'restoreConflict', label: 'Restore Conflict Markers' },
		{ id: 'stage', label: 'Mark Resolved (Stage)' },
	];
	const listUnstageMenu: FileMenuAction[] = [
		{ id: 'unstage', label: 'Unstage' },
		{ id: 'stashFile', label: 'Stash This File…' },
	];
	// Untracked: the pattern alone is enough, and nothing touches the index.
	const listUntrackedMenu: FileMenuAction[] = [
		...listStageMenu,
		{ id: 'ignore', label: 'Add to .gitignore' },
	];
	// Tracked: the pattern is inert until the file leaves the index, so the two have to go together.
	const listTrackedMenu: FileMenuAction[] = [
		...listStageMenu,
		{ id: 'ignoreAndUntrack', label: 'Stop Tracking & Add to .gitignore' },
	];

	function commit(message: string, amend: boolean, options: CommitOptions): void {
		dialog = null;
		onaction(amend ? 'amend' : 'commit', undefined, message, {
			noVerify: options.noVerify,
			// Pushing after an amend is a force push — that one is never done on the side.
			pushAfter: !amend && options.pushAfter,
		});
	}

	function openCommitDialog(): void {
		commitTemplate.request();
		dialog = 'commit';
	}

	// A commit the host refused (a hook, an empty message) brings the dialog back with what was
	// typed. Only refusals after this tab appeared count: one from before is not this tab's to answer.
	let seenReopen = untrack(() => commitDraft.reopenNonce);
	$effect(() => {
		const nonce = commitDraft.reopenNonce;
		if (nonce === seenReopen) return;
		seenReopen = nonce;
		openCommitDialog();
	});
</script>

<div class="tab">
	<div class="toolbar">
		<button
			class="push"
			onclick={() => (dialog = 'push')}
			oncontextmenu={(event) => {
				event.preventDefault();
				dialog = 'forcePush';
			}}
			disabled={ahead === 0}
			use:tooltip={ahead > 0
				? `Push ${ahead} commit${ahead === 1 ? '' : 's'} to the remote — right-click to force push (with lease)`
				: 'Push — nothing to push, the remote is up to date'}
		>
			<Icon name="arrow-up" />
			Push{ahead > 0 ? ` ${ahead}` : ''}
		</button>
		<span class="gg-island" role="group" aria-label="Working tree actions">
			<IconButton
				name="discard"
				label="Undo last commit"
				title="Undo last commit — put its changes back as staged, keeping your work"
				onclick={() => (dialog = 'undo')}
			/>
			<IconButton
				name="archive"
				label="Stash uncommitted changes"
				title="Stash — save all uncommitted changes aside and clean the working tree"
				disabled={changes.length + untracked.length + staged.length === 0}
				onclick={() => onaction('stash')}
			/>
			<IconButton
				name="remove"
				label="Unstage all"
				title="Unstage all — move every staged file back out of the next commit"
				onclick={() => onaction('unstageAll')}
			/>
			<IconButton
				name="add"
				label="Stage all"
				title="Stage all — include every changed and untracked file in the next commit"
				onclick={() => onaction('stageAll')}
			/>
		</span>
		<span class="ai gg-island" role="group" aria-label="AI">
			<IconButton
				name="sparkle"
				label="Explain changes with AI"
				title={changes.length + untracked.length + staged.length + conflicts.length === 0
					? 'Explain changes — nothing has changed yet'
					: 'Explain changes — let the AI commit agent describe what the uncommitted changes do'}
				disabled={changes.length + untracked.length + staged.length + conflicts.length === 0}
				onclick={() => aiCommit.explain({ kind: 'working' })}
			/>
			<IconButton
				name="wand"
				label="AI commit"
				title={changes.length + untracked.length + staged.length + conflicts.length === 0
					? 'AI commit — nothing has changed yet'
					: 'AI commit — let an agent CLI draft the message for the staged files, or a split into several commits'}
				disabled={changes.length + untracked.length + staged.length + conflicts.length === 0}
				onclick={() =>
					staged.length === 0
						? (dialog = 'aiNoStaged')
						: aiCommit.openDialog([...new Set(staged.map((f) => f.path))])}
			/>
		</span>
		<button
			class="primary"
			onclick={openCommitDialog}
			disabled={staged.length === 0}
			use:tooltip={staged.length === 0
				? 'Commit — stage at least one file first'
				: `Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}`}
		>
			Commit
		</button>
	</div>

	<div class="sections">
		<!-- Only the sections that exist: an empty one is nothing to act on, so it says nothing.
		     A clean tree gets one line instead of a column of "No files". -->
		{#if working !== null && conflicts.length + changes.length + untracked.length + staged.length === 0}
			<div class="clean">
				<Icon name="check" />
				<span>Working tree clean</span>
				{#if ahead > 0}
					<span class="clean-sub">{ahead} commit{ahead === 1 ? '' : 's'} ready to push</span>
				{/if}
			</div>
		{:else}
			<!-- Staged first, as in VS Code's own Source Control: it is what Commit is about to take.
			     Conflicts stay above everything, because nothing commits until they are settled. -->
			{#if conflicts.length > 0}
				{@render section(
					'conflicts',
					'Conflicts',
					conflicts,
					listStageActions,
					listConflictMenu,
					'unstaged'
				)}
			{/if}
			{#if staged.length > 0}
				{@render section(
					'staged',
					'Staged Changes',
					staged,
					listUnstageActions,
					listUnstageMenu,
					'staged'
				)}
			{/if}
			{#if changes.length > 0}
				{@render section(
					'changes',
					'Changes',
					changes,
					listStageActions,
					listTrackedMenu,
					'unstaged'
				)}
			{/if}
			{#if untracked.length > 0}
				{@render section(
					'untracked',
					'Untracked',
					untracked,
					listStageActions,
					listUntrackedMenu,
					'unstaged'
				)}
			{/if}
		{/if}
	</div>
</div>

{#snippet section(
	id: WorkingSection,
	title: string,
	listFiles: FileChange[],
	actions: FileRowAction<WorkingTreeAction>[],
	listMenuActions: FileMenuAction[],
	side: WorkingDiffSide
)}
	{@const isCollapsed = prefs.listCollapsedSections.includes(id)}
	<!-- One card per group, folded from its header; the folds are kept with the other view
	     preferences, so a long Staged list stays out of the way across reloads. -->
	<section class="group" class:collapsed={isCollapsed}>
		<h3>
			<button
				class="group-head"
				aria-expanded={!isCollapsed}
				onclick={() => prefs.toggleSection(id)}
			>
				<!-- No whitespace before the title: the heading's text must start with the group's name. -->
				<Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} /><span class="title"
					>{title}</span
				>
				<span class="count">{listFiles.length}</span>
			</button>
		</h3>
		{#if isCollapsed}
			<!-- Folded: the header alone stands for the group. -->
		{:else if listFiles.length === 0}
			<p class="empty">No files</p>
		{:else if fileView === 'tree'}
			<FileTree
				nodes={buildFileTree(listFiles)}
				{activePath}
				{actions}
				{onaction}
				onopen={(path) => onopenFile(path, side)}
				onmenu={(event, file) => onmenu(event, file, listMenuActions)}
			/>
		{:else}
			<ul>
				{#each listFiles as file (file.path)}
					<FileRow
						{file}
						active={file.path === activePath}
						{actions}
						{onaction}
						onopen={(path) => onopenFile(path, side)}
						onmenu={(event) => onmenu(event, file, listMenuActions)}
					/>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#if dialog === 'commit'}
	<CommitDialog
		stagedCount={staged.length}
		template={commitTemplate.text}
		pushAfter={prefs.settings.pushAfterCommit}
		onpushAfter={(value) => prefs.setSettings({ ...prefs.settings, pushAfterCommit: value })}
		draft={commitDraft.current}
		ondraft={commitDraft.keep}
		oncommit={commit}
		oncancel={() => {
			commitDraft.clear();
			dialog = null;
		}}
	/>
{:else if dialog === 'push'}
	<ConfirmDialog
		title="Push to remote"
		message="Push {ahead} commit{ahead === 1 ? '' : 's'} to the remote?"
		onconfirm={() => {
			dialog = null;
			onpush();
		}}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'forcePush'}
	<ConfirmDialog
		title="Force push"
		message="Force push (with lease) rewrites the remote branch. Anyone who already pulled it will have to reconcile their history. Continue?"
		confirmLabel="Force push"
		danger
		onconfirm={() => {
			dialog = null;
			onpushForce();
		}}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'aiNoStaged'}
	<ConfirmDialog
		title="AI commit"
		message="AI commit only includes staged files, and nothing is staged yet. Stage all changes and continue?"
		confirmLabel="Stage all & continue"
		onconfirm={() => {
			dialog = null;
			aiCommit.openDialog(
				[...new Set([...conflicts, ...changes, ...untracked].map((f) => f.path))],
				{ stageAll: true }
			);
		}}
		oncancel={() => (dialog = null)}
	/>
{:else if dialog === 'undo'}
	<ConfirmDialog
		title="Undo last commit"
		message="The last commit will be removed and its changes put back as staged, so nothing is lost. Avoid this if the commit is already pushed."
		confirmLabel="Undo commit"
		onconfirm={() => {
			dialog = null;
			onaction('undoCommit');
		}}
		oncancel={() => (dialog = null)}
	/>
{/if}

<style>
	.tab {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		height: var(--gg-header-h);
		box-sizing: border-box;
		flex: none;
		padding: 0 var(--gg-space-2);
		border-bottom: 1px solid var(--gg-seam);
	}
	/* The labelled buttons; the icon-only ones are `IconButton` and bring their own square. */
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: var(--gg-hit);
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: var(--gg-radius);
		cursor: pointer;
		padding: 0 5px;
	}
	.toolbar button:hover:not(:disabled) {
		background: var(--gg-bg-tool-hover);
	}
	.toolbar button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.toolbar .push {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
	}
	.toolbar .push:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* The right-hand cluster: the AI island carries the auto margin, Commit rides beside it. */
	.toolbar .ai {
		margin-left: auto;
	}
	.toolbar .primary {
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		border-color: transparent;
	}
	.toolbar .primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.sections {
		flex: 1;
		overflow: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-2);
	}
	/* One block per group on a soft fill, no frame: the gap between fills shows where each ends. */
	.group {
		flex: none;
		padding-bottom: var(--gg-space-1);
		border-radius: var(--gg-radius-lg);
		background: var(--gg-tint);
	}
	.group.collapsed {
		padding-bottom: 0;
	}
	h3 {
		margin: 0;
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		width: 100%;
		height: var(--gg-control-h);
		padding: 0 var(--gg-space-2) 0 var(--gg-space-1);
		border: none;
		border-radius: var(--gg-radius-lg);
		background: transparent;
		color: var(--gg-fg-muted);
		font: inherit;
		font-size: var(--gg-text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-align: left;
		text-transform: uppercase;
		cursor: pointer;
	}
	.group-head:hover {
		color: var(--gg-fg);
	}
	.group-head:focus-visible {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	.group-head :global(.codicon) {
		font-size: var(--gg-icon-sm);
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 16px;
		margin-left: auto;
		padding: 0 5px;
		box-sizing: border-box;
		border-radius: 999px;
		background: var(--gg-badge-bg);
		color: var(--gg-badge-fg);
		font-size: var(--gg-text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.empty {
		margin: 0;
		padding: 2px var(--gg-space-3);
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	.clean {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gg-space-1);
		padding: var(--gg-space-4) var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
	.clean :global(.codicon) {
		color: var(--gg-success);
		font-size: var(--gg-icon-lg);
	}
	.clean-sub {
		font-size: var(--gg-text-xs);
		opacity: 0.8;
	}
</style>
