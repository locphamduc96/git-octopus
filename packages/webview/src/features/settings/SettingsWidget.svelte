<script lang="ts">
	import type { CommitOrder, GitIdentity } from '@git-octopus/shared';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import IdentitySection from './IdentitySection.svelte';
	import type {
		DateFormat,
		DateType,
		DiffTarget,
		GraphStyle,
		RepoIdentityState,
		RowDensity,
		ViewSettings,
	} from '../../lib/viewSettings';

	let {
		settings,
		identity,
		listIdentities,
		suggestedIdentity,
		onapplyIdentity,
		onclearIdentityOverride,
		onsaveIdentities,
		onchange,
		onclose,
	}: {
		settings: ViewSettings;
		identity: RepoIdentityState | null;
		listIdentities: GitIdentity[];
		/** The identity the repo's remote suggests when it differs from the one in use. */
		suggestedIdentity: GitIdentity | null;
		onapplyIdentity: (identity: GitIdentity) => void;
		onclearIdentityOverride: () => void;
		onsaveIdentities: (listIdentities: GitIdentity[]) => void;
		onchange: (settings: ViewSettings) => void;
		onclose: () => void;
	} = $props();

	const listLimits = [100, 300, 500, 1000];
	const listDateFormats: { value: DateFormat; label: string }[] = [
		{ value: 'dateTime', label: 'Date & Time' },
		{ value: 'dayTime', label: 'Today / Yesterday & Time' },
		{ value: 'dateOnly', label: 'Date Only' },
		{ value: 'iso', label: 'ISO Date & Time' },
		{ value: 'relative', label: 'Relative' },
	];
	const listOrders: { value: CommitOrder; label: string }[] = [
		{ value: 'date', label: 'Commit date' },
		{ value: 'authorDate', label: 'Author date' },
		{ value: 'topo', label: 'Topological' },
	];

	function set<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
		onchange({ ...settings, [key]: value });
	}

	type Tab = 'general' | 'graph' | 'commits' | 'identity';
	const listTabs: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'graph', label: 'Graph' },
		{ id: 'commits', label: 'Commits & Dates' },
		{ id: 'identity', label: 'Identity' },
	];
	let tab = $state<Tab>('general');
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<!-- The backdrop deliberately does NOT close the dialog: settings changes apply live, and a stray
     click outside must not throw the panel away mid-adjustment. Close is the ✕ button or Escape. -->
<div class="backdrop">
	<div class="panel" role="dialog" aria-modal="true" aria-label="Settings">
		<header>
			<span>Settings</span>
			<IconButton
				name="close"
				label="Close settings"
				title="Close settings (Esc)"
				onclick={onclose}
			/>
		</header>

		<div class="tabs" role="tablist">
			{#each listTabs as item (item.id)}
				<button
					role="tab"
					aria-selected={tab === item.id}
					class:active={tab === item.id}
					onclick={() => (tab = item.id)}
				>
					{item.label}
				</button>
			{/each}
		</div>

		<div class="content">
			{#if tab === 'general'}
				<section>
					<div class="row">
						<span class="row-label">Commits to load</span>
						<select
							value={String(settings.commitLimit)}
							onchange={(event) => set('commitLimit', Number(event.currentTarget.value))}
						>
							{#each listLimits as limit (limit)}
								<option value={String(limit)}>{limit}</option>
							{/each}
						</select>
					</div>
					<div class="row">
						<span class="row-label">
							Show author avatars
							<span class="note">Loaded from Gravatar using a hash of the author's email.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.fetchAvatars}
							onchange={(event) => set('fetchAvatars', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">
							Open diffs in
							<span class="note">
								The panel keeps the review inside this view, without opening tabs. Changes-only or
								whole-file is chosen in the panel's own header.
							</span>
						</span>
						<select
							value={settings.diffTarget}
							onchange={(event) => set('diffTarget', event.currentTarget.value as DiffTarget)}
						>
							<option value="editor">VS Code editor</option>
							<option value="panel">Git Octopus panel</option>
						</select>
					</div>
					<div class="row">
						<span class="row-label">
							Scroll to HEAD on load
							<span class="note">Jump to the checked-out commit after the graph loads.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.scrollToHeadOnLoad}
							onchange={(event) => set('scrollToHeadOnLoad', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">
							Fast-forward on checkout
							<span class="note">
								Checking out a branch from its remote brings it up to date when it has only fallen
								behind. Never runs on a branch with commits of its own, or while you have
								uncommitted changes.
							</span>
						</span>
						<input
							type="checkbox"
							checked={settings.autoFastForwardOnCheckout}
							onchange={(event) => set('autoFastForwardOnCheckout', event.currentTarget.checked)}
						/>
					</div>
				</section>
			{:else if tab === 'graph'}
				<section>
					<div class="row">
						<span class="row-label">Graph style</span>
						<select
							value={settings.graphStyle}
							onchange={(event) => set('graphStyle', event.currentTarget.value as GraphStyle)}
						>
							<option value="rounded">Rounded</option>
							<option value="curved">Curved</option>
							<option value="angular">Angular</option>
							<option value="diagonal">Diagonal</option>
						</select>
					</div>
					<div class="row">
						<span class="row-label">
							Row height
							<span class="note">How much space each commit row takes.</span>
						</span>
						<select
							value={settings.rowDensity}
							onchange={(event) => set('rowDensity', event.currentTarget.value as RowDensity)}
						>
							<option value="compact">Compact</option>
							<option value="comfortable">Comfortable</option>
							<option value="spacious">Spacious</option>
						</select>
					</div>
					<div class="row">
						<span class="row-label">
							Highlight branch line on hover
							<span class="note">When off, hovering a commit only highlights its row.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.highlightBranchOnHover}
							onchange={(event) => set('highlightBranchOnHover', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">
							Mute merge commits
							<span class="note">Dim merge-commit rows so the real work stands out.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.muteMergeCommits}
							onchange={(event) => set('muteMergeCommits', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">
							Show ticket badge
							<span class="note">When off, a leading [TICKET] stays in the subject text.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.showTicketBadge}
							onchange={(event) => set('showTicketBadge', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">
							Show type badge
							<span class="note">
								The feat / fix / chore chip, and the merge chip. When off, `feat:` reads as part of
								the subject.
							</span>
						</span>
						<input
							type="checkbox"
							checked={settings.showTypeBadge}
							onchange={(event) => set('showTypeBadge', event.currentTarget.checked)}
						/>
					</div>
				</section>
			{:else if tab === 'commits'}
				<section>
					<div class="row">
						<span class="row-label">
							Commit ordering
							<span class="note">Topological keeps a branch's commits together.</span>
						</span>
						<select
							value={settings.commitOrder}
							onchange={(event) => set('commitOrder', event.currentTarget.value as CommitOrder)}
						>
							{#each listOrders as order (order.value)}
								<option value={order.value}>{order.label}</option>
							{/each}
						</select>
					</div>
					<div class="row">
						<span class="row-label">Date column shows</span>
						<select
							value={settings.dateType}
							onchange={(event) => set('dateType', event.currentTarget.value as DateType)}
						>
							<option value="commit">Commit date</option>
							<option value="author">Author date</option>
						</select>
					</div>
					<div class="row">
						<span class="row-label">Date format</span>
						<select
							value={settings.dateFormat}
							onchange={(event) => set('dateFormat', event.currentTarget.value as DateFormat)}
						>
							{#each listDateFormats as format (format.value)}
								<option value={format.value}>{format.label}</option>
							{/each}
						</select>
					</div>
					<div class="row">
						<span class="row-label">
							Show remote branches
							<span class="note">Include commits that only exist on remote branches.</span>
						</span>
						<input
							type="checkbox"
							checked={settings.showRemoteBranches}
							onchange={(event) => set('showRemoteBranches', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">Show tags</span>
						<input
							type="checkbox"
							checked={settings.showTags}
							onchange={(event) => set('showTags', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">Show stashes</span>
						<input
							type="checkbox"
							checked={settings.showStashes}
							onchange={(event) => set('showStashes', event.currentTarget.checked)}
						/>
					</div>
					<div class="row">
						<span class="row-label">Show uncommitted changes</span>
						<input
							type="checkbox"
							checked={settings.showUncommitted}
							onchange={(event) => set('showUncommitted', event.currentTarget.checked)}
						/>
					</div>
				</section>
			{:else}
				<section class="lead">
					<div class="row">
						<span class="row-label">
							Auto-apply identity by remote
							<span class="note">
								When a repository has no identity override and exactly one saved identity matches
								its remotes, apply that identity automatically. Ambiguous matches only warn.
							</span>
						</span>
						<input
							type="checkbox"
							checked={settings.autoApplyIdentity}
							onchange={(event) => set('autoApplyIdentity', event.currentTarget.checked)}
						/>
					</div>
				</section>
				<IdentitySection
					{identity}
					{listIdentities}
					{suggestedIdentity}
					{onapplyIdentity}
					{onclearIdentityOverride}
					{onsaveIdentities}
				/>
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--gg-space-4);
		background: rgba(0, 0, 0, 0.45);
	}
	.panel {
		display: flex;
		flex-direction: column;
		width: min(640px, 100%);
		max-height: min(80vh, 100%);
		background: var(--vscode-editorWidget-background, var(--gg-bg));
		border: 1px solid var(--gg-border);
		border-radius: 6px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex: none;
		font-weight: 600;
		font-size: 1.05em;
		padding: var(--gg-space-3) var(--gg-space-4);
		border-bottom: 1px solid var(--gg-border);
	}
	.content {
		overflow: auto;
		min-height: 0;
		padding: 0 var(--gg-space-4) var(--gg-space-4);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3) 0;
	}
	/* Sits directly above another section (the identity cards), so it gives its padding up. */
	section.lead {
		padding-bottom: 0;
	}
	/* Label left, control right, every row on one baseline. */
	.row {
		display: flex;
		align-items: center;
		gap: var(--gg-space-4);
	}
	.row-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.row select,
	.row input[type='checkbox'] {
		flex: none;
	}
	.note {
		margin: 0;
		font-size: 0.8em;
		color: var(--gg-fg-muted);
	}
	select {
		background: var(--vscode-dropdown-background, var(--gg-bg));
		color: var(--vscode-dropdown-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-dropdown-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 2px var(--gg-space-1);
		min-width: 150px;
	}
	.tabs {
		display: flex;
		flex: none;
		gap: var(--gg-space-1);
		padding: 0 var(--gg-space-4);
		border-bottom: 1px solid var(--gg-border);
	}
	.tabs button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--gg-fg-muted);
		font: inherit;
		padding: var(--gg-space-2) var(--gg-space-2);
		cursor: pointer;
	}
	.tabs button:hover {
		color: var(--gg-fg);
	}
	.tabs button.active {
		color: var(--gg-fg);
		border-bottom-color: var(--gg-accent);
	}
</style>
