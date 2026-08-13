<script lang="ts">
	import type { CommitDetails, Person } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';
	import Icon from '../../lib/ui/Icon.svelte';

	let {
		details,
		loading,
		onopenDiff,
		oncopy,
		onselectCommit,
	}: {
		details: CommitDetails | null;
		loading: boolean;
		onopenDiff: (path: string) => void;
		oncopy: (text: string) => void;
		onselectCommit: (hash: string) => void;
	} = $props();

	const totals = $derived.by(() => {
		let additions = 0;
		let deletions = 0;
		for (const file of details?.files ?? []) {
			additions += file.additions ?? 0;
			deletions += file.deletions ?? 0;
		}
		return { additions, deletions };
	});

	/** The committer is only worth a line of its own when it differs from the author. */
	const showCommitter = $derived(
		details !== null &&
			(details.committer.email !== details.author.email ||
				details.committedAt !== details.authoredAt)
	);

	function fmtWhen(epochSeconds: number): string {
		return new Date(epochSeconds * 1000).toLocaleString();
	}

	function personLabel(person: Person): string {
		return person.email ? `${person.name} <${person.email}>` : person.name;
	}
</script>

<div class="tab">
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if !details}
		<p class="hint">Select a commit to see its details.</p>
	{:else}
		<dl class="meta">
			<dt>Commit</dt>
			<dd>
				<button class="link mono" onclick={() => oncopy(details.hash)} title="Copy the full hash">
					{details.hash}
				</button>
			</dd>

			{#if details.parents.length > 0}
				<dt>{details.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
				<dd class="parents">
					{#each details.parents as parent (parent)}
						<button
							class="link mono"
							onclick={() => onselectCommit(parent)}
							title="Show {parent}"
						>
							{parent.slice(0, 8)}
						</button>
					{/each}
				</dd>
			{/if}

			<dt>Author</dt>
			<dd class="person" title={personLabel(details.author)}>
				{#if details.author.avatarUrl}
					<img class="avatar" src={details.author.avatarUrl} alt="" />
				{/if}
				<span class="name">{personLabel(details.author)}</span>
				<span class="when">{fmtWhen(details.authoredAt)}</span>
			</dd>

			{#if showCommitter}
				<dt>Committer</dt>
				<dd class="person" title={personLabel(details.committer)}>
					{#if details.committer.avatarUrl}
						<img class="avatar" src={details.committer.avatarUrl} alt="" />
					{/if}
					<span class="name">{personLabel(details.committer)}</span>
					<span class="when">{fmtWhen(details.committedAt)}</span>
				</dd>
			{/if}
		</dl>

		{#if details.body}
			<pre class="body">{details.body}</pre>
		{/if}

		<h3>
			<Icon name="files" />
			{details.files.length} file{details.files.length === 1 ? '' : 's'} changed
			{#if totals.additions > 0}<span class="add">+{totals.additions}</span>{/if}
			{#if totals.deletions > 0}<span class="del">−{totals.deletions}</span>{/if}
		</h3>
		<ul>
			{#each details.files as file (file.path)}
				<FileRow {file} onopen={onopenDiff} />
			{/each}
		</ul>
	{/if}
</div>

<style>
	.tab {
		height: 100%;
		overflow: auto;
		min-height: 0;
	}
	.meta {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px var(--gg-space-2);
		margin: 0;
		padding: var(--gg-space-2);
		border-bottom: 1px solid var(--gg-border);
		font-size: 0.9em;
	}
	dt {
		color: var(--gg-fg-muted);
		white-space: nowrap;
	}
	dd {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.parents {
		display: flex;
		gap: var(--gg-space-2);
	}
	.person {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when {
		flex: none;
		margin-left: auto;
		color: var(--gg-fg-muted);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.9em;
	}
	.avatar {
		flex: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--gg-accent);
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.body {
		margin: 0;
		padding: var(--gg-space-3) var(--gg-space-2);
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
		padding: var(--gg-space-1) var(--gg-space-2);
		border-top: 1px solid var(--gg-border);
		border-bottom: 1px solid var(--gg-border);
		font-size: 0.85em;
		font-weight: 600;
		color: var(--gg-fg-muted);
	}
	.add {
		color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50);
	}
	.del {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--gg-space-3);
	}
	.hint {
		padding: var(--gg-space-3);
		color: var(--gg-fg-muted);
	}
</style>
