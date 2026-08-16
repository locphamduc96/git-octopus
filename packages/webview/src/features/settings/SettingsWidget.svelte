<script lang="ts">
	import type { DateFormat as CommitDateFormat } from '../../lib/commitDate';

	/** Owned by `lib/commitDate`, where the formatting lives; re-named here for the settings API. */
	export type DateFormat = CommitDateFormat;
	export type GraphStyle = 'rounded' | 'angular' | 'diagonal';
	/** How tall a commit row is drawn — named for the space around the text, not a pixel count. */
	export type RowDensity = 'compact' | 'comfortable' | 'spacious';
	/** Where a file diff opens: a VS Code editor tab, or the panel in place of the graph. */
	export type DiffTarget = 'editor' | 'panel';
	/** How much of the file the diff panel draws. */
	export type DiffMode = 'compact' | 'full';
	/** Which of a commit's two dates the Date column shows. */
	export type DateType = 'commit' | 'author';

	export interface ViewSettings {
		commitLimit: number;
		commitOrder: CommitOrder;
		dateFormat: DateFormat;
		dateType: DateType;
		graphStyle: GraphStyle;
		rowDensity: RowDensity;
		diffTarget: DiffTarget;
		diffMode: DiffMode;
		fetchAvatars: boolean;
		highlightBranchOnHover: boolean;
		muteMergeCommits: boolean;
		/** Off for either one leaves that part of the subject as plain text. */
		showTicketBadge: boolean;
		showTypeBadge: boolean;
		showRemoteBranches: boolean;
		showTags: boolean;
		showStashes: boolean;
		showUncommitted: boolean;
		scrollToHeadOnLoad: boolean;
	}

	/** The active repository's effective Git identity, as reported by the host. */
	export interface RepoIdentityState {
		name: string | null;
		email: string | null;
		hasLocalName: boolean;
		hasLocalEmail: boolean;
		listRemoteUrls: string[];
		/** The global config's identity, reported even while a local override hides it. */
		globalName: string | null;
		globalEmail: string | null;
	}

	import type { CommitOrder, GitIdentity } from '@git-octopus/shared';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { remoteHost } from '../../lib/identity';

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

	/**
	 * Which card is being edited: an index into the list, or `'new'` for the one being added. Only
	 * ever one at a time, so a single draft serves both.
	 */
	let editing = $state<number | 'new' | null>(null);
	let draft = $state({ label: '', name: '', email: '', hostPattern: '' });

	/**
	 * The host of this repo's first remote, shown beside the pattern field for reference only. It is
	 * never filled in: which repositories an identity covers is the user's call, not a guess.
	 */
	const currentHost = $derived(
		identity?.listRemoteUrls.map(remoteHost).find((host) => host !== null) ?? null
	);

	function startAddIdentity(): void {
		draft = { label: '', name: '', email: '', hostPattern: '' };
		editing = 'new';
	}

	/** Whether this repository's own config overrides the global identity. */
	const overridden = $derived(identity?.hasLocalName === true || identity?.hasLocalEmail === true);
	const hasGlobal = $derived((identity?.globalName ?? identity?.globalEmail ?? null) !== null);

	function startEditIdentity(index: number): void {
		const item = listIdentities[index];
		draft = {
			label: item.label,
			name: item.name,
			email: item.email,
			hostPattern: item.hostPattern ?? '',
		};
		editing = index;
	}

	function saveDraftIdentity(): void {
		const hostPattern = draft.hostPattern.trim();
		const next: GitIdentity = {
			label: draft.label.trim(),
			name: draft.name.trim(),
			email: draft.email.trim(),
			...(hostPattern !== '' ? { hostPattern } : {}),
		};
		onsaveIdentities(
			editing === 'new'
				? [...listIdentities, next]
				: listIdentities.map((item, index) => (index === editing ? next : item))
		);
		editing = null;
	}

	function deleteIdentity(target: GitIdentity): void {
		editing = null;
		onsaveIdentities(listIdentities.filter((item) => item !== target));
	}

	const identitySource = $derived(
		identity && (identity.hasLocalName || identity.hasLocalEmail)
			? 'set for this repository'
			: 'inherited from the global Git config'
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

{#snippet identityForm()}
	<div class="id-form">
		<label>
			Label
			<input placeholder="Work, Personal…" bind:value={draft.label} />
		</label>
		<label>
			User name
			<input placeholder="user.name" bind:value={draft.name} />
		</label>
		<label>
			Email
			<input placeholder="user.email" bind:value={draft.email} />
		</label>
		<label>
			Suggest for remotes containing (optional)
			<input placeholder="e.g. git.mycompany.com" bind:value={draft.hostPattern} />
			{#if currentHost}
				<span class="note">This repository's remote host: {currentHost}</span>
			{/if}
		</label>
		<div class="id-form-actions">
			<button
				class="mini"
				onclick={saveDraftIdentity}
				disabled={draft.label.trim() === '' || draft.email.trim() === ''}
			>
				Save
			</button>
			<button class="mini" onclick={() => (editing = null)}>Cancel</button>
		</div>
	</div>
{/snippet}

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
				<section>
					{#if identity}
						<p class="note">
							Committing as <b class="fg"
								>{identity.name ?? '(no name)'} &lt;{identity.email ?? 'no email'}&gt;</b
							>
							— {identitySource}.
						</p>
						{#if suggestedIdentity}
							<p class="note warn">
								This repository's remote suggests “{suggestedIdentity.label}” ({suggestedIdentity.email}).
							</p>
						{/if}
						<!-- Only reachable when there is no global identity to switch back to; otherwise the
					     global card's own Apply does this, and two controls for one action read as two
					     different actions. -->
						{#if overridden && !hasGlobal}
							<button class="linkish" onclick={onclearIdentityOverride}>
								Clear the repository override (fall back to global)
							</button>
						{/if}
					{/if}

					<div class="cards">
						<!-- A fixture, not a list entry: the global identity cannot be edited or deleted from
					     here, and it stays visible while a repository override hides it — an override you
					     cannot see past is a switch with no way back. -->
						{#if hasGlobal}
							<div class="card fixed" class:in-use={!overridden}>
								<div class="card-head">
									<b class="fg">{identity?.globalName || '(no name)'}</b>
									{#if !overridden}<span class="pill">In use</span>{/if}
									<span class="card-actions">
										<button class="mini" onclick={onclearIdentityOverride} disabled={!overridden}>
											Apply
										</button>
									</span>
								</div>
								<span class="card-line">{identity?.globalEmail ?? '(no email)'}</span>
								<span class="card-line note"
									>Global Git config — used by every repository without an override</span
								>
							</div>
						{/if}

						{#each listIdentities as item, index (item.label + item.email)}
							{@const inUse = identity?.email === item.email && identity?.name === item.name}
							<div class="card" class:in-use={inUse}>
								{#if editing === index}
									{@render identityForm()}
								{:else}
									<div class="card-head">
										<b class="fg">{item.label}</b>
										{#if inUse}<span class="pill">In use</span>{/if}
										<span class="card-actions">
											<button class="mini" onclick={() => onapplyIdentity(item)} disabled={inUse}>
												Apply
											</button>
											<IconButton
												name="edit"
												label="Edit identity"
												onclick={() => startEditIdentity(index)}
											/>
											<IconButton
												name="trash"
												label="Delete identity"
												onclick={() => deleteIdentity(item)}
											/>
										</span>
									</div>
									<span class="card-line">{item.name || '(no name)'} &lt;{item.email}&gt;</span>
									<span class="card-line note">
										{#if item.hostPattern}
											Suggested for remotes containing “{item.hostPattern}”
										{:else}
											No remote pattern — never suggested automatically
										{/if}
									</span>
								{/if}
							</div>
						{/each}

						{#if editing === 'new'}
							<div class="card">{@render identityForm()}</div>
						{/if}
					</div>

					{#if editing === null}
						<button class="linkish" onclick={startAddIdentity}>+ Add identity…</button>
					{/if}
				</section>
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
	/* Label left, control right, every row on one baseline — the git-graph dialog layout. */
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
	.fg {
		color: var(--gg-fg);
	}
	.warn {
		color: var(--vscode-editorWarning-foreground, #cca700);
	}
	.linkish {
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		font: inherit;
		font-size: 0.85em;
		color: var(--gg-accent);
		cursor: pointer;
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
	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--gg-space-2) var(--gg-space-3);
		border: 1px solid var(--gg-border);
		border-radius: 4px;
		min-width: 0;
	}
	.card.in-use {
		border-color: var(--gg-accent);
	}
	/* Reads as part of the panel rather than an entry of the list, which is what it is. */
	.card.fixed {
		background: color-mix(in srgb, var(--gg-fg-muted) 8%, transparent);
		border-style: dashed;
	}
	.card.fixed.in-use {
		border-style: solid;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
	}
	.card-actions {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		margin-left: auto;
	}
	.card-line {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85em;
	}
	.pill {
		font-size: 0.75em;
		padding: 0 var(--gg-space-1);
		border-radius: 8px;
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
	}
	.id-form label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 0.8em;
		color: var(--gg-fg-muted);
	}
	.mini {
		flex: none;
		display: inline-flex;
		align-items: center;
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		font: inherit;
		font-size: 0.8em;
		padding: 1px var(--gg-space-1);
		cursor: pointer;
	}
	.mini:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.id-form {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
	}
	.id-form input {
		background: var(--vscode-input-background, var(--gg-bg));
		color: var(--vscode-input-foreground, var(--gg-fg));
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		font-size: 0.85em;
		padding: 2px var(--gg-space-1);
	}
	.id-form-actions {
		display: flex;
		gap: var(--gg-space-1);
	}
</style>
