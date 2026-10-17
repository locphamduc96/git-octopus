<script lang="ts">
	import type { CommitDetails, FileChange, Person } from '@git-octopus/shared';
	import FileRow from '../../lib/ui/FileRow.svelte';
	import FileTree from '../../lib/ui/FileTree.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import { buildFileTree, type FileViewMode } from '../../lib/fileTree';
	import { MAP_SIGNATURE_LOOK } from '../../lib/signature';

	let {
		details,
		loading,
		fileView,
		activePath,
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
		activePath: string | null;
		/**
		 * Whether the rest of the message, below its subject, is shown. The subject and the meta lines
		 * stay visible either way, so collapsing a long message leaves the file list more room.
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
			title={metaOpen ? 'Hide the rest of the message' : 'Show the whole message'}
			aria-expanded={metaOpen}
		>
			<!-- Open means the whole message, so the subject wraps instead of ellipsizing. -->
			<span class="subject" class:open={metaOpen} title={metaOpen ? undefined : subject}
				>{subject}</span
			>
		</button>

		<!-- Who and when, then where it sits: one compact block, the same whether the message is open
		     or not, so the hash and the parents are always one click away. -->
		<div class="meta">
			<div class="meta-line" title={personLabel(details.author)}>
				{#if details.author.avatarUrl}
					<img class="avatar" src={details.author.avatarUrl} alt="" />
				{/if}
				<span class="name">{details.author.name}</span>
				<span class="muted">· {fmtWhen(details.authoredAt)}</span>
			</div>
			{#if showCommitter}
				<div class="meta-line muted" title={personLabel(details.committer)}>
					<span class="name"
						>committed by {details.committer.name} · {fmtWhen(details.committedAt)}</span
					>
				</div>
			{/if}
			<div class="meta-line">
				<button
					class="link mono hash"
					onclick={() => oncopy(details.hash)}
					title="Copy the full hash {details.hash}"
				>
					{details.hash.slice(0, 8)}<Icon name="copy" />
				</button>
				{#if details.parents.length > 0}
					<span class="muted">{details.parents.length > 1 ? 'parents' : 'parent'}</span>
					{#each details.parents as parent (parent)}
						<button class="link mono" onclick={() => onselectCommit(parent)} title="Show {parent}">
							{parent.slice(0, 8)}
						</button>
					{/each}
				{/if}
			</div>
			{#if details.signature}
				{@const look = MAP_SIGNATURE_LOOK[details.signature.status]}
				<div class="meta-line signature {look.tone}" title={details.signature.key}>
					<Icon name={look.icon} />
					<span class="name">
						{look.label}{details.signature.signer ? ` — ${details.signature.signer}` : ''}
					</span>
					{#if details.signature.key}<span class="key mono">{details.signature.key}</span>{/if}
				</div>
			{/if}
		</div>

		{#if metaOpen && restOfBody}
			<pre class="body">{restOfBody}</pre>
		{/if}

		<h3>
			<Icon name="files" />
			{details.files.length} file{details.files.length === 1 ? '' : 's'} changed
			{#if totals.additions > 0}<span class="add">+{totals.additions}</span>{/if}
			{#if totals.deletions > 0}<span class="del">−{totals.deletions}</span>{/if}
		</h3>
		{#if fileView === 'tree'}
			<FileTree nodes={tree} {activePath} onopen={onopenDiff} {onmenu} />
		{:else}
			<ul>
				{#each details.files as file (file.path)}
					<FileRow
						{file}
						active={file.path === activePath}
						onopen={onopenDiff}
						onmenu={(event) => onmenu(event, file)}
					/>
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
		background: var(--gg-bg-hover);
	}
	.subject {
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.subject.open {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 0 var(--gg-space-2) var(--gg-space-2);
		font-size: var(--gg-text-sm);
	}
	.meta-line {
		display: flex;
		align-items: center;
		gap: var(--gg-space-1);
		min-width: 0;
		white-space: nowrap;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--gg-fg-muted);
	}
	.hash {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.hash :global(.codicon) {
		font-size: var(--gg-icon-xs);
		opacity: 0.75;
	}
	.meta-line.signature {
		flex-wrap: wrap;
	}
	.signature.good > :global(.codicon) {
		color: var(--gg-success);
	}
	.signature.warn > :global(.codicon) {
		color: var(--gg-warning);
	}
	.signature.bad > :global(.codicon) {
		color: var(--gg-danger);
	}
	.signature .key {
		flex-basis: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
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
		font-family: var(--gg-font-mono);
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
		font-size: var(--gg-text-xs);
		font-weight: 600;
		color: var(--gg-fg-muted);
	}
	.add {
		color: var(--gg-added);
	}
	.del {
		color: var(--gg-deleted);
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
