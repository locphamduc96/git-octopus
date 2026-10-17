<script lang="ts">
	import type {
		BranchRef,
		GitIdentity,
		RepoInfo,
		RepoState,
		SequencerActionMessage,
	} from '@git-octopus/shared';
	import { buildIdentityMenu, IDENTITY_ITEM } from '../../lib/identityMenu';
	import ContextMenu, { type MenuItem } from '../../lib/ui/ContextMenu.svelte';
	import Dropdown from '../../lib/ui/Dropdown.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import RefIcon from '../../lib/ui/RefIcon.svelte';
	import { tooltip } from '../../lib/ui/tooltip';

	let {
		repos,
		activeRepo,
		repoName,
		listBranches,
		currentBranch,
		loading,
		notice,
		listSolo,
		hiddenCount,
		onshowHidden,
		onclearFilter,
		onjumpBranch,
		commitCount,
		ahead,
		behind,
		undoLabel,
		redoLabel = null,
		onundo,
		onredo = () => {},
		repoState,
		onselectRepo,
		onrefresh,
		onterminal,
		onfind,
		onfetch,
		onpull,
		onpullOption,
		onpush,
		onpushForce,
		onsequencer,
		previousBranch,
		headHash,
		onbackToPreviousBranch,
		onbranchFromHead,
		onshowHead,
		onsettings,
		oncleanup,
		identityLabel,
		identityInitials,
		identityLine,
		identityWarning,
		listIdentities,
		activeEmail,
		globalIdentity,
		overridden,
		onuseGlobal,
		suggestedIdentity,
		onapplyIdentity,
		onaddIdentity,
		onidentity,
	}: {
		repos: RepoInfo[];
		activeRepo: string | null;
		repoName: string | null;
		/** Branches offered for jumping — local first, then remote-tracking. */
		listBranches: BranchRef[];
		currentBranch: string | null;
		/** The first load: nothing is known about this repository yet, so nothing is claimed. */
		loading: boolean;
		/** Transient message, e.g. when a branch tip sits outside the loaded history. */
		notice: string | null;
		/** The ref the graph is filtered down to, or null when it shows everything. */
		/** The branches the graph is limited to; empty when it shows all of them. */
		listSolo: string[];
		/** How many refs are hidden from the graph. */
		hiddenCount: number;
		onshowHidden: () => void;
		onclearFilter: () => void;
		/** Scroll the graph to a branch's commit. Never checks anything out. */
		onjumpBranch: (branch: BranchRef) => void;
		commitCount: number;
		/** Commits this branch has that its upstream does not, and the other way round. */
		ahead: number;
		behind: number;
		/** What Undo would undo, as a phrase; null disables the button. */
		undoLabel: string | null;
		/** What Redo would put back — the action last undone; null disables the button. */
		redoLabel?: string | null;
		onundo: () => void;
		onredo?: () => void;
		/** A paused rebase/merge/cherry-pick/revert — shows the Continue/Abort banner. */
		repoState: RepoState | null;
		onselectRepo: (path: string) => void;
		onrefresh: () => void;
		onterminal: () => void;
		onfind: () => void;
		onfetch: () => void;
		onpull: () => void;
		/** Pull with a strategy chosen from the right-click menu, for this once. */
		onpullOption: (action: 'pullRebase' | 'pullFf' | 'pullFfIfPossible') => void;
		onpush: () => void;
		onpushForce: () => void;
		onsequencer: (action: SequencerActionMessage['action']) => void;
		/** The branch HEAD left, offered as the way back while detached. */
		previousBranch: string | null;
		/** The commit HEAD points at — named in the detached banner. */
		headHash: string | null;
		onbackToPreviousBranch: () => void;
		onbranchFromHead: () => void;
		onshowHead: () => void;
		onsettings: () => void;
		/** Open the dialog that deletes local branches nobody has touched in months. */
		oncleanup: () => void;
		/** Label of the Git identity in use (saved-identity label, else the name, else the email). */
		identityLabel: string | null;
		/** Letters drawn in the avatar beside the label. */
		identityInitials: string;
		/** "Name <email>" commits are stamped with — the tooltip, since the label drops the email. */
		identityLine: string;
		/** Set when the repo's remote suggests a different identity — shown as a warning state. */
		identityWarning: string | null;
		/** Saved identities offered in the account dropdown, and the email currently committing. */
		listIdentities: GitIdentity[];
		activeEmail: string | null;
		/** The global config's identity, and whether this repository currently overrides it. */
		globalIdentity: { name: string | null; email: string | null } | null;
		overridden: boolean;
		onuseGlobal: () => void;
		/** Set when this repository's remote points at an identity other than the one in use. */
		suggestedIdentity: GitIdentity | null;
		onapplyIdentity: (identity: GitIdentity) => void;
		onaddIdentity: () => void;
		onidentity: () => void;
	} = $props();

	let pushMenu = $state<{ x: number; y: number } | null>(null);
	let identityMenu = $state<{ x: number; y: number } | null>(null);

	const identityItems = $derived(
		buildIdentityMenu({
			listIdentities,
			activeEmail,
			suggestedIdentity,
			globalIdentity,
			overridden,
		})
	);

	function onIdentitySelect(id: string): void {
		identityMenu = null;
		if (id === IDENTITY_ITEM.unsavedCurrent) return;
		if (id === IDENTITY_ITEM.useGlobal) {
			onuseGlobal();
			return;
		}
		if (id === IDENTITY_ITEM.suggested) {
			if (suggestedIdentity) onapplyIdentity(suggestedIdentity);
		} else if (id === IDENTITY_ITEM.add) onaddIdentity();
		else if (id === IDENTITY_ITEM.manage) onidentity();
		else {
			const picked = listIdentities[Number(id)];
			if (picked) onapplyIdentity(picked);
		}
	}
	let pullMenu = $state<{ x: number; y: number } | null>(null);
	const listPullItems: MenuItem<'pull' | 'pullRebase' | 'pullFf' | 'pullFfIfPossible'>[] = [
		{ id: 'pull', label: 'Pull (default strategy)' },
		{ id: 'pullFfIfPossible', label: 'Pull (fast-forward if possible)' },
		{ id: 'pullFf', label: 'Pull (fast-forward only)' },
		{ id: 'pullRebase', label: 'Pull (rebase)' },
	];

	const mapStateLabel: Record<RepoState, string> = {
		rebasing: 'Rebase in progress',
		merging: 'Merge in progress',
		cherryPicking: 'Cherry-pick in progress',
		reverting: 'Revert in progress',
	};

	const repoOptions = $derived(repos.map((repo) => ({ value: repo.path, label: repo.name })));

	/*
	 * The dropdown is navigation, not a filter: its value stays on the checked-out branch, and
	 * picking an entry only moves the view. Keyed by name — two remotes can hold the same branch
	 * name at the same commit, and a hash key would collapse them into one row.
	 */
	const branchOptions = $derived(
		listBranches.map((branch) => ({
			value: branch.name,
			label: branch.name,
			group: branch.remote ? 'Remote' : 'Local',
		}))
	);

	function onBranchPick(name: string): void {
		const branch = listBranches.find((entry) => entry.name === name);
		if (branch) onjumpBranch(branch);
	}
</script>

<!-- The same two glyphs the ref chips carry, so a column reads as the chips it will jump to. -->
{#snippet heading(name: string)}
	<RefIcon name={name === 'Remote' ? 'cloud' : 'device-desktop'} size={12} />
	{name}
{/snippet}

<div class="bar">
	{#if repos.length > 1}
		<Dropdown
			label="Repo:"
			value={activeRepo ?? ''}
			options={repoOptions}
			filterable
			onchange={onselectRepo}
		/>
	{:else if repoName}
		<span class="repo"><Icon name="source-control" />{repoName}</span>
	{/if}

	<!-- The name only reports where HEAD is; jumping somewhere else is the button beside it. One
	     control doing both made the checked-out branch look like a choice among the others. -->
	<span class="branch" use:tooltip={'The branch you have checked out'}>
		<Icon name="git-branch" />
		<span class="branch-label">Branch:</span>
		<!-- "detached HEAD" is a fact about the repository, not a stand-in for not having asked yet. -->
		{#if loading}
			<span class="gg-skeleton-bar branch-bar"></span>
		{:else if currentBranch}
			<span class="branch-name">{currentBranch}</span>
		{:else}
			<span class="branch-name detached">detached HEAD</span>
		{/if}
	</span>

	{#if branchOptions.length > 0}
		<Dropdown
			value={currentBranch ?? ''}
			options={branchOptions}
			columns
			filterable
			{heading}
			triggerIcon="versions"
			triggerTitle="Jump to a branch"
			onchange={onBranchPick}
		/>
	{/if}

	{#if listSolo.length > 0}
		<!-- The places that say the graph is not showing everything — and undo it. -->
		<button
			class="filter-pill"
			title={`Showing only ${listSolo.join(', ')} — click to show all branches`}
			onclick={onclearFilter}
		>
			<Icon name="filter" />
			<span class="filter-name">{listSolo.join(', ')}</span>
			<Icon name="close" />
		</button>
	{/if}
	{#if hiddenCount > 0}
		<button
			class="filter-pill"
			title={`${hiddenCount} ref${hiddenCount === 1 ? ' is' : 's are'} hidden — click to show them again`}
			onclick={onshowHidden}
		>
			<Icon name="eye-closed" />
			<span class="filter-name">{hiddenCount} hidden</span>
			<Icon name="close" />
		</button>
	{/if}

	{#if notice}<span class="notice">{notice}</span>{/if}

	<span class="spacer"></span>

	<!-- Three groups, read left to right: what talks to the remote and the history, who commits, and
	     what configures the view. Each sits on its own island; no rule between them. -->
	<div class="actions">
		{#if commitCount > 0}
			<span class="count">{commitCount} commits</span>
		{/if}
		<span class="gg-island" role="group" aria-label="Remote and history">
			<IconButton
				name="cloud-download"
				label="Fetch"
				title="Fetch — download commits from all remotes and prune deleted branches"
				onclick={onfetch}
			/>
			<!-- Not disabled at zero behind: the right-click strategies (rebase / ff-only) are exactly
		     what you reach for regardless of the count shown. -->
			<button
				onclick={onpull}
				oncontextmenu={(event) => {
					event.preventDefault();
					pullMenu = { x: event.clientX, y: event.clientY };
				}}
				use:tooltip={behind > 0
					? `Pull — merge ${behind} commit${behind === 1 ? '' : 's'} from the remote into this branch; right-click for rebase / ff-only`
					: 'Pull — this branch is up to date; right-click for rebase / ff-only'}
			>
				<Icon name="arrow-down" label="Pull" />
				{#if behind > 0}<span class="drift">{behind}</span>{/if}
			</button>
			<!-- Never disabled on a zero count: a branch with no upstream yet is exactly the one that
		     needs publishing, and it reads as 0 ahead. -->
			<button
				onclick={onpush}
				oncontextmenu={(event) => {
					event.preventDefault();
					pushMenu = { x: event.clientX, y: event.clientY };
				}}
				use:tooltip={ahead > 0
					? `Push ${ahead} commit${ahead === 1 ? '' : 's'} to the remote — right-click for force push`
					: 'Push — publish this branch to the remote; right-click for force push'}
			>
				<Icon name="arrow-up" label="Push" />
				{#if ahead > 0}<span class="drift">{ahead}</span>{/if}
			</button>
			<IconButton
				name="refresh"
				label="Refresh"
				title="Refresh — reload the graph and working tree (Ctrl/Cmd + R)"
				onclick={onrefresh}
			/>
			<!-- The tooltip names the action rather than saying "Undo": what one press will change is
		     the only thing worth knowing before pressing it. -->
			<IconButton
				name="discard"
				label="Undo"
				title={undoLabel
					? `Undo ${undoLabel} — puts the branches back where they were`
					: 'Undo — nothing to undo yet'}
				disabled={!undoLabel}
				onclick={onundo}
			/>
			<IconButton
				name="redo"
				label="Redo"
				title={redoLabel
					? `Redo ${redoLabel} — puts back what Undo took away`
					: 'Redo — nothing undone to put back'}
				disabled={!redoLabel}
				onclick={onredo}
			/>
		</span>

		{#if identityLabel}
			<span class="gg-island">
				<button
					class="identity"
					class:warning={identityWarning !== null}
					aria-label="Git identity: {identityLine}"
					use:tooltip={identityWarning ?? `${identityLine} — click to switch identity`}
					onclick={(event) => {
						const rect = event.currentTarget.getBoundingClientRect();
						identityMenu = { x: rect.left, y: rect.bottom + 2 };
					}}
				>
					{#if identityInitials}
						<span class="avatar" aria-hidden="true">{identityInitials}</span>
					{:else}
						<Icon name="account" />
					{/if}
					<span class="identity-label">{identityLabel}</span>
				</button>
			</span>
		{/if}
		<span class="gg-island" role="group" aria-label="Tools">
			<IconButton name="search" label="Find commits" onclick={onfind} />
			<IconButton
				name="trash"
				label="Clean up branches"
				title="Clean up branches — delete local branches older than a chosen age"
				onclick={oncleanup}
			/>
			<IconButton name="terminal" label="Open terminal" onclick={onterminal} />
			<IconButton name="settings-gear" label="Settings" onclick={onsettings} />
		</span>
	</div>
</div>

{#if repoState}
	<div class="sequencer">
		<Icon name="warning" />
		<span class="state">{mapStateLabel[repoState]}</span>
		<span class="hint">— resolve conflicts, stage them, then continue</span>
		<span class="seq-actions">
			<button class="primary" onclick={() => onsequencer('continue')}>Continue</button>
			{#if repoState !== 'merging'}
				<button onclick={() => onsequencer('skip')}>Skip</button>
			{/if}
			<button onclick={() => onsequencer('abort')}>Abort</button>
		</span>
	</div>
{/if}

<!-- Detached HEAD says nothing about what to do next, and the way back is a command most people
     look up. The bar that reports it carries the ways out. -->
{#if !loading && currentBranch === null && headHash}
	<div class="sequencer">
		<Icon name="warning" />
		<span class="state">Detached HEAD</span>
		<span class="hint"
			>— at {headHash.slice(0, 7)}, not on any branch; new commits belong to no branch</span
		>
		<span class="seq-actions">
			{#if previousBranch}
				<button class="primary" onclick={onbackToPreviousBranch}>Back to {previousBranch}</button>
			{/if}
			<button onclick={onbranchFromHead}>Branch from here</button>
			<button onclick={onshowHead}>Show commit</button>
		</span>
	</div>
{/if}

{#if pullMenu}
	<ContextMenu
		x={pullMenu.x}
		y={pullMenu.y}
		items={listPullItems}
		onselect={(id) => {
			pullMenu = null;
			if (id === 'pull') onpull();
			else onpullOption(id);
		}}
		onclose={() => (pullMenu = null)}
	/>
{/if}

{#if pushMenu}
	<ContextMenu
		x={pushMenu.x}
		y={pushMenu.y}
		items={[
			{ id: 'push', label: 'Push' },
			{ id: 'pushForce', label: 'Force Push (with lease)…' },
		]}
		onselect={(id) => {
			pushMenu = null;
			if (id === 'push') onpush();
			else onpushForce();
		}}
		onclose={() => (pushMenu = null)}
	/>
{/if}

{#if identityMenu}
	<ContextMenu
		x={identityMenu.x}
		y={identityMenu.y}
		items={identityItems}
		onselect={onIdentitySelect}
		onclose={() => (identityMenu = null)}
	/>
{/if}

<style>
	/*
	 * Wraps instead of holding one line: narrow the view far enough and a fixed row can only make its
	 * controls overlap each other. What it must not do is come out some height of its own — every bar
	 * in the window is `--gg-header-h` tall, and this one being a pixel over pushed the column headers
	 * out of line with the panel beside them. So each wrapped line is exactly one header tall and the
	 * bar is a whole number of them: 30, 60, 90.
	 *
	 * It sits on the raised tone, which is what parts it from the graph below. The seam is an inset
	 * shadow rather than a border because a border would add its pixel on top of those lines and put
	 * the whole thing back out by one; it only shows in high-contrast themes.
	 */
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: var(--gg-space-3);
		row-gap: 0;
		min-height: var(--gg-header-h);
		box-sizing: border-box;
		padding: 0 var(--gg-space-2);
		background: var(--gg-bg-raised);
		box-shadow: inset 0 -1px 0 var(--gg-seam);
		flex: none;
		min-width: 0;
	}
	.bar > :global(*) {
		height: var(--gg-header-h);
		display: inline-flex;
		align-items: center;
	}
	/* The banner interrupts the reading flow on purpose: nothing else works until this is dealt with. */
	.sequencer {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		flex: none;
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		background: color-mix(in srgb, var(--gg-warning) 14%, transparent);
		color: var(--gg-fg);
		white-space: nowrap;
		overflow: hidden;
	}
	.sequencer .state {
		font-weight: 600;
	}
	.sequencer .hint {
		color: var(--gg-fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.seq-actions {
		display: flex;
		gap: var(--gg-space-1);
		margin-left: auto;
	}
	.seq-actions button {
		background: transparent;
		color: var(--gg-fg);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		cursor: pointer;
		font: inherit;
		padding: 1px var(--gg-space-2);
	}
	.seq-actions button:hover {
		background: var(--gg-bg-tool-hover);
	}
	.seq-actions .primary {
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		border-color: transparent;
	}
	.seq-actions .primary:hover {
		background: var(--gg-btn-hover);
	}
	.branch {
		display: inline-flex;
		align-items: center;
		gap: var(--gg-space-1);
		min-width: 0;
		white-space: nowrap;
	}
	.branch-label {
		color: var(--gg-fg-muted);
	}
	.branch-name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.branch-bar {
		display: inline-block;
		width: 90px;
		height: 9px;
	}
	.branch-name.detached {
		font-weight: 400;
		color: var(--gg-fg-muted);
	}
	.repo {
		display: inline-flex;
		align-items: center;
		gap: var(--gg-space-1);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spacer {
		flex: 1;
	}
	.notice {
		color: var(--gg-warning);
		font-size: var(--gg-text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Same baseline rule as every text control in this row: `--gg-hit` tall and flex-centered,
	   so it sits level with the icon buttons regardless of font size. */
	.filter-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: var(--gg-hit);
		padding: 0 var(--gg-space-2);
		border: 1px solid var(--gg-option-border);
		border-radius: 999px;
		background: var(--gg-option-bg);
		color: var(--gg-option-fg);
		font-size: var(--gg-text-xs);
		cursor: pointer;
		white-space: nowrap;
		max-width: 220px;
	}
	.filter-pill:hover {
		background: var(--gg-bg-tool-hover);
	}
	.filter-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
		white-space: nowrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
		margin-left: auto;
	}
	/*
	 * The buttons that are not plain icons — a badge beside the glyph, or a label after it. Same
	 * height as `IconButton` so the whole row sits on one line; see "UI conventions" in AGENTS.md.
	 */
	.actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		height: var(--gg-hit);
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: var(--gg-radius);
		cursor: pointer;
		padding: 0 4px;
	}
	.actions button:hover:not(:disabled) {
		background: var(--gg-bg-tool-hover);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* The arrow is the icon beside it, so the count alone completes the ↑N ↓N every chip shows. */
	.drift {
		color: var(--gg-accent);
		font-size: var(--gg-text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.actions button.identity {
		gap: var(--gg-space-1);
		padding: 0 6px 0 2px;
	}
	/* Letters rather than a generic person glyph: two identities tell apart before the label is read,
	   and the label can drop the email (it lives in the tooltip) to give the bar its room back. */
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--gg-btn-bg);
		color: var(--gg-btn-fg);
		font-size: var(--gg-text-xs);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.identity-label {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--gg-text-sm);
	}
	.actions button.identity.warning {
		color: var(--gg-warning);
	}
	.actions button.identity.warning .avatar {
		background: var(--gg-warning);
		color: var(--gg-bg);
	}
</style>
