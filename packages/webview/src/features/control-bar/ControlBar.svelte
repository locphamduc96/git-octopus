<script lang="ts">
	import type { RepoInfo } from '@git-octopus/shared';
	import Dropdown from '../../lib/ui/Dropdown.svelte';
	import Icon from '../../lib/ui/Icon.svelte';

	const SHOW_ALL = ' all';

	let {
		repos,
		activeRepo,
		repoName,
		commitCount,
		listBranches,
		branch,
		showRemoteBranches,
		behind,
		onselectRepo,
		onselectBranch,
		ontoggleRemote,
		onrefresh,
		onterminal,
		onfind,
		onfetch,
		onpull,
		onsettings,
	}: {
		repos: RepoInfo[];
		activeRepo: string | null;
		repoName: string | null;
		commitCount: number;
		listBranches: string[];
		branch: string | null;
		showRemoteBranches: boolean;
		behind: number;
		onselectRepo: (path: string) => void;
		onselectBranch: (branch: string | null) => void;
		ontoggleRemote: (show: boolean) => void;
		onrefresh: () => void;
		onterminal: () => void;
		onfind: () => void;
		onfetch: () => void;
		onpull: () => void;
		onsettings: () => void;
	} = $props();

	const repoOptions = $derived(repos.map((repo) => ({ value: repo.path, label: repo.name })));
	const branchOptions = $derived([
		{ value: SHOW_ALL, label: 'Show All' },
		...listBranches.map((name) => ({ value: name, label: name })),
	]);
</script>

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

	<Dropdown
		label="Branches:"
		value={branch ?? SHOW_ALL}
		options={branchOptions}
		filterable
		onchange={(next) => onselectBranch(next === SHOW_ALL ? null : next)}
	/>

	<label class="remote" title="Include commits that only exist on remote branches (e.g. origin/…)">
		<input
			type="checkbox"
			checked={showRemoteBranches}
			onchange={(event) => ontoggleRemote(event.currentTarget.checked)}
		/>
		Show Remote Branches
	</label>

	<span class="spacer"></span>

	{#if commitCount > 0}
		<span class="count">{commitCount} commits</span>
	{/if}

	<div class="actions">
		<button
			onclick={onfind}
			title="Find commits — search by message, author or hash (Ctrl/Cmd + F)"
		>
			<Icon name="search" label="Find commits" />
		</button>
		<button onclick={onterminal} title="Open a terminal in this repository's folder">
			<Icon name="terminal" label="Open terminal" />
		</button>
		<button
			onclick={onfetch}
			title="Fetch — download commits from all remotes and prune deleted branches"
		>
			<Icon name="cloud-download" label="Fetch" />
		</button>
		<button
			onclick={onpull}
			title={behind > 0
				? `Pull — merge ${behind} commit${behind === 1 ? '' : 's'} from the remote into this branch`
				: 'Pull — nothing to pull, this branch is up to date'}
			disabled={behind === 0}
		>
			<Icon name="arrow-down" label="Pull" />
			{#if behind > 0}<span class="badge">{behind}</span>{/if}
		</button>
		<button onclick={onsettings} title="Settings — commits to load, date format, graph style">
			<Icon name="settings-gear" label="Settings" />
		</button>
		<button onclick={onrefresh} title="Refresh — reload the graph and working tree (Ctrl/Cmd + R)">
			<Icon name="refresh" label="Refresh" />
		</button>
	</div>
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		padding: var(--gg-space-1) var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		flex: none;
		min-width: 0;
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
	.remote {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		white-space: nowrap;
		cursor: pointer;
	}
	.spacer {
		flex: 1;
	}
	.count {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 1px;
		flex: none;
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: transparent;
		color: var(--gg-fg);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		padding: 3px 4px;
	}
	.actions button:hover:not(:disabled) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.badge {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border-radius: 8px;
		padding: 0 var(--gg-space-1);
		font-size: 0.8em;
	}
</style>
