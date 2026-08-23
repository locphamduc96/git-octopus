<script lang="ts">
	import type { GitIdentity, WorkspaceIdentityEntry } from '@git-octopus/shared';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import { remoteHost } from '../../lib/identity';
	import { cardBadges, unsavedCurrentIdentity } from '../../lib/identityCards';
	import type { RepoIdentityState } from '../../lib/viewSettings';
	import { buildWorkspaceRows, canSaveEntry } from '../../lib/workspaceIdentityRows';

	let {
		identity,
		listIdentities,
		listWorkspaceIdentities,
		suggestedIdentity,
		onapplyIdentity,
		onclearIdentityOverride,
		onsaveIdentities,
	}: {
		identity: RepoIdentityState | null;
		listIdentities: GitIdentity[];
		listWorkspaceIdentities: WorkspaceIdentityEntry[];
		/** The identity the repo's remote suggests when it differs from the one in use. */
		suggestedIdentity: GitIdentity | null;
		onapplyIdentity: (identity: GitIdentity) => void;
		onclearIdentityOverride: () => void;
		onsaveIdentities: (listIdentities: GitIdentity[]) => void;
	} = $props();

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

	const unsavedCurrent = $derived(unsavedCurrentIdentity(identity, listIdentities));
	const listWorkspaceRows = $derived(buildWorkspaceRows(listWorkspaceIdentities));

	function startSaveEntry(entry: WorkspaceIdentityEntry): void {
		if (entry.email === null) return;
		draft = { label: '', name: entry.name ?? '', email: entry.email, hostPattern: '' };
		editing = 'new';
	}

	function startSaveCurrentIdentity(): void {
		if (unsavedCurrent === null) return;
		draft = { label: '', name: unsavedCurrent.name, email: unsavedCurrent.email, hostPattern: '' };
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
			Suggest for remotes containing (optional, comma-separated)
			<input
				placeholder="e.g. git.mycompany.com, github.com/client"
				bind:value={draft.hostPattern}
			/>
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

		<!-- The invitation for a fresh install: the account already committing here, not yet a
		     card. Hidden while a form is open so it cannot compete with the form it opens. -->
		{#if unsavedCurrent && editing === null}
			<div class="card fixed">
				<div class="card-head">
					<b class="fg">{unsavedCurrent.name || '(no name)'}</b>
					<span class="card-actions">
						<button class="mini" onclick={startSaveCurrentIdentity}>Save…</button>
					</span>
				</div>
				<span class="card-line">{unsavedCurrent.email}</span>
				<span class="card-line note">Currently committing as this — not saved yet</span>
			</div>
		{/if}

		{#each listIdentities as item, index (item.label + item.email)}
			{@const badges = cardBadges(identity, item, overridden)}
			<div class="card" class:in-use={badges.showInUse}>
				{#if editing === index}
					{@render identityForm()}
				{:else}
					<div class="card-head">
						<b class="fg">{item.label}</b>
						{#if badges.showInUse}<span class="pill">In use</span>{/if}
						<span class="card-actions">
							<button
								class="mini"
								onclick={() => onapplyIdentity(item)}
								disabled={badges.applyDisabled}
							>
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
						{#if badges.sameAsGlobal}
							Same as your global identity — safe to delete
						{:else if item.hostPattern}
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

	{#if listWorkspaceRows.length > 0}
		<h4 class="ws-title">This workspace</h4>
		<table class="ws">
			<tbody>
				{#each listWorkspaceRows as row (row.repoPath)}
					<tr>
						<td class="ws-repo fg" title={row.repoPath}>{row.repoName}</td>
						<td class="ws-email" title={row.name ?? ''}>{row.email ?? '(no email)'}</td>
						<td class="ws-badge">
							{#if row.overridden}<span class="pill">override</span>{/if}
							{#if editing === null && canSaveEntry(row, listIdentities)}
								<button class="mini" onclick={() => startSaveEntry(row)}>Save…</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3) 0;
	}
	.note {
		margin: 0;
		font-size: 0.8em;
		color: var(--gg-fg-muted);
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
	.ws-title {
		margin: var(--gg-space-2) 0 0;
		font-size: 0.85em;
		font-weight: 600;
	}
	.ws {
		border-collapse: collapse;
		width: 100%;
		table-layout: fixed;
		font-size: 0.85em;
	}
	.ws td {
		padding: 1px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ws-repo {
		width: 40%;
		padding-right: var(--gg-space-2);
	}
	.ws-email {
		color: var(--gg-fg-muted);
	}
	.ws-badge {
		width: 8em;
		text-align: right;
		white-space: nowrap;
	}
	.ws-badge > * + * {
		margin-left: var(--gg-space-1);
	}
</style>
