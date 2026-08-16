<script lang="ts">
	import type { CommitDetails, FileChange, Person } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';

	let {
		details,
		loading,
		fileView,
		metaOpen,
		onmetaOpen,
		onopenDiff,
		onmenu,
		oncopy,
		onselectCommit,
	}: {
		details: CommitDetails | null;
		loading: boolean;
		fileView: FileViewMode;
		/**
		 * Whether the full message and the hash/parent/author block are expanded. The subject and
		 * byline stay visible either way, so collapsing leaves the file list more room.
		 */
		metaOpen: boolean;
		onmetaOpen: (open: boolean) => void;
		onopenDiff: (path: string) => void;
		onmenu: (event: MouseEvent, file: FileChange) => void;
		oncopy: (text: string) => void;
		onselectCommit: (hash: string) => void;
	} = $props();

	const tree = $derived(buildFileTree(details?.files ?? []));
	/** The first line of the message, which is what the graph shows as the commit's subject. */
	const subject = $derived(details?.body.split('\n', 1)[0] ?? '');
	const restOfBody = $derived((details?.body ?? '').slice(subject.length).replace(/^\n+/, ''));

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

<!--
	The animation hangs off the class rather than a wrapper: the details are a flat run of siblings
	inside the scroller, and picking another commit flips `loading` for a moment, which is what makes
	the class leave and come back — so each commit fades in, not only the first.
-->
<div class="tab" class:gg-enter-fade={!loading && details}>
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if !details}
		<p class="hint">Select a commit to see its details.</p>
	{:else}
		<!-- Still a toggle — the unfold button in the panel header is the visible control, but the
		     line itself staying clickable keeps the bigger target. -->
		<button
			class="subject-bar"
			onclick={() => onmetaOpen(!metaOpen)}
			title={metaOpen
				? 'Hide the full message, hash, parents and author'
				: 'Show the full message, hash, parents and author'}
			aria-expanded={metaOpen}
		>
			<span class="lines">
				<!-- Open means the whole message, so the subject wraps instead of ellipsizing. -->
				<span class="subject" class:open={metaOpen} title={metaOpen ? undefined : subject}
					>{subject}</span
				>
				<!-- Only while the block below is closed. Open, it says all three again and in full —
				     the short hash is the first eight characters of the one it prints, and the name and
				     date are the same characters twice, a few pixels apart. -->
				{#if !metaOpen}
					<span class="byline">
						<span class="mono">{details.hash.slice(0, 8)}</span>
						· {details.author.name}
						· {fmtWhen(details.authoredAt)}
					</span>
				{/if}
			</span>
		</button>

		{#if metaOpen}
			<dl class="meta">
				<dt><Icon name="git-commit" />Commit</dt>
				<dd>
					<button class="link mono" onclick={() => oncopy(details.hash)} title="Copy the full hash">
						{details.hash}
					</button>
				</dd>

				{#if details.parents.length > 0}
					<dt><Icon name="git-merge" />{details.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
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

				<dt><Icon name="person" />Author</dt>
				<dd class="person" title={personLabel(details.author)}>
					{#if details.author.avatarUrl}
						<img class="avatar" src={details.author.avatarUrl} alt="" />
					{/if}
					<span class="name">{personLabel(details.author)}</span>
					<span class="when">{fmtWhen(details.authoredAt)}</span>
				</dd>

				{#if showCommitter}
					<dt><Icon name="verified" />Committer</dt>
					<dd class="person" title={personLabel(details.committer)}>
						{#if details.committer.avatarUrl}
							<img class="avatar" src={details.committer.avatarUrl} alt="" />
						{/if}
						<span class="name">{personLabel(details.committer)}</span>
						<span class="when">{fmtWhen(details.committedAt)}</span>
					</dd>
				{/if}
			</dl>

			{#if restOfBody}
				<pre class="body">{restOfBody}</pre>
			{/if}
		{/if}

		<h3>
			<Icon name="files" />
			{details.files.length} file{details.files.length === 1 ? '' : 's'} changed
			{#if totals.additions > 0}<span class="add">+{totals.additions}</span>{/if}
			{#if totals.deletions > 0}<span class="del">−{totals.deletions}</span>{/if}
		</h3>
		{#if fileView === 'tree'}
			<FileTree nodes={tree} onopen={onopenDiff} {onmenu} />
		{:else}
			<ul>
				{#each details.files as file (file.path)}
					<FileRow {file} onopen={onopenDiff} onmenu={(event) => onmenu(event, file)} />
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.tab {
		height: 100%;
		overflow: auto;
		min-height: 0;
	}
	.subject-bar {
		display: flex;
		align-items: flex-start;
		gap: var(--gg-space-1);
		width: 100%;
		padding: var(--gg-space-2);
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.subject-bar:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.lines {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.subject {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.subject.open {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.byline {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px var(--gg-space-2);
		margin: 0;
		padding: 0 var(--gg-space-2) var(--gg-space-2);
		font-size: 0.9em;
	}
	dt {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		color: var(--gg-fg-muted);
		white-space: nowrap;
	}
	dt :global(.codicon) {
		font-size: 13px;
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
	/*
	 * No rules of its own. Whatever sits above — the subject bar, or the meta block when it is open —
	 * already draws one, and a `border-top` here landed straight underneath it: one line, twice as
	 * thick. Below it, the muted heading is enough to separate itself from the file list, the way the
	 * working-tree tab has always done it.
	 */
	h3 {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
		padding: var(--gg-space-2) var(--gg-space-2) var(--gg-space-1);
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
