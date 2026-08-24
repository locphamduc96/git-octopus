<script lang="ts">
	import type { AgentId, CommitOrder, GitIdentity, WorkspaceIdentityEntry } from '@git-octopus/shared';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import IdentitySection from './IdentitySection.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
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
		listWorkspaceIdentities,
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
		listWorkspaceIdentities: WorkspaceIdentityEntry[];
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

	type Tab = 'general' | 'graph' | 'commits' | 'ai' | 'identity';
	const listTabs: { id: Tab; label: string; icon: string }[] = [
		{ id: 'general', label: 'General', icon: 'settings-gear' },
		{ id: 'graph', label: 'Graph', icon: 'git-branch' },
		{ id: 'commits', label: 'Commits & Dates', icon: 'git-commit' },
		{ id: 'ai', label: 'AI', icon: 'sparkle' },
		{ id: 'identity', label: 'Identity', icon: 'account' },
	];
	let tab = $state<Tab>('general');

	/**
	 * Thinking levels per CLI, for the ones that have an effort flag; agents absent here get only
	 * "CLI default" and a disabled control. The empty choice leaves the CLI on its own default.
	 */
	const mapThinkingOptions: Partial<Record<AgentId, string[]>> = {
		claude: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
		codex: ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
	};

	/**
	 * Known model choices per CLI — aliases for Claude, current ids for Codex. Deliberately not
	 * exhaustive: a custom provider (or next month's model) goes through Custom, which frees the
	 * text field.
	 */
	const CUSTOM_MODEL = '__custom__';
	const LIST_FALLBACK_MODELS: { value: string; label: string }[] = [
		{ value: '', label: 'CLI default' },
		{ value: CUSTOM_MODEL, label: 'Custom…' },
	];
	const mapModelOptions: Partial<Record<AgentId, { value: string; label: string }[]>> = {
		claude: [
			{ value: '', label: 'CLI default' },
			{ value: 'haiku', label: 'haiku — cheapest, plenty for commits' },
			{ value: 'sonnet', label: 'sonnet' },
			{ value: 'opus', label: 'opus' },
			{ value: 'fable', label: 'fable — most capable, expensive' },
			{ value: CUSTOM_MODEL, label: 'Custom…' },
		],
		codex: [
			{ value: '', label: 'CLI default' },
			{ value: 'gpt-5.6-luna', label: 'gpt-5.6-luna — cheap, high-volume' },
			{ value: 'gpt-5.6-terra', label: 'gpt-5.6-terra — everyday workhorse' },
			{ value: 'gpt-5.6-sol', label: 'gpt-5.6-sol — frontier, expensive' },
			{ value: CUSTOM_MODEL, label: 'Custom… (e.g. a custom provider model)' },
		],
		gemini: [
			{ value: '', label: 'CLI default' },
			{ value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite — cheapest' },
			{ value: 'gemini-3.5-flash', label: 'gemini-3.5-flash — everyday' },
			{ value: 'gemini-3.1-pro', label: 'gemini-3.1-pro — flagship' },
			{ value: CUSTOM_MODEL, label: 'Custom…' },
		],
	};


	const aiAgentId = $derived(aiCommit.inventory?.savedAgentId ?? null);
	const listModelOptions = $derived(
		(aiAgentId ? mapModelOptions[aiAgentId] : undefined) ?? LIST_FALLBACK_MODELS
	);
	const listThinkingLevels = $derived(
		(aiAgentId ? mapThinkingOptions[aiAgentId] : undefined) ?? ['']
	);
	let draftModel = $state('');
	/** True while the user is typing a model the preset list does not know. */
	let customModel = $state(false);
	// The draft follows whatever the host reports; a save comes straight back as a fresh
	// inventory, so the loop settles on the stored value.
	$effect(() => {
		const inv = aiCommit.inventory;
		const id = inv?.savedAgentId;
		const model = inv && id ? (inv.mapModels[id] ?? '') : '';
		draftModel = model;
		const listOptions = id ? (mapModelOptions[id] ?? LIST_FALLBACK_MODELS) : LIST_FALLBACK_MODELS;
		customModel = id ? model !== '' && !listOptions.some((option) => option.value === model) : false;
	});

	const modelSelectValue = $derived(customModel ? CUSTOM_MODEL : draftModel);

	function pickModelOption(value: string): void {
		if (value === CUSTOM_MODEL) {
			customModel = true;
			return;
		}
		customModel = false;
		draftModel = value;
		if (aiAgentId) aiCommit.saveAiSettings(null, { [aiAgentId]: value }, {});
	}

	function openTab(next: Tab): void {
		tab = next;
		if (next === 'ai') aiCommit.loadInventory();
	}

	function saveAiModel(): void {
		if (aiAgentId) aiCommit.saveAiSettings(null, { [aiAgentId]: draftModel }, {});
	}

	function saveAiThinking(value: string): void {
		if (aiAgentId) aiCommit.saveAiSettings(null, {}, { [aiAgentId]: value });
	}
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
					onclick={() => openTab(item.id)}
				>
					<Icon name={item.icon} />
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
			{:else if tab === 'ai'}
				<section>
					{#if !aiCommit.inventory}
						<p class="note">Looking for agent CLIs…</p>
					{:else}
						<div class="row">
							<span class="row-label">
								Agent
								<span class="note">
									Which CLI writes the AI commit plan. Picking one also records your consent to
									sending the diff to it.
								</span>
							</span>
							<div class="agent-choice" role="radiogroup" aria-label="AI commit agent">
								{#each aiCommit.inventory.listAgents as agent (agent.id)}
									<label class="agent-option" class:disabled={agent.state !== 'ready'}>
										<input
											type="radio"
											name="ai-agent"
											value={agent.id}
											checked={aiAgentId === agent.id}
											disabled={agent.state !== 'ready'}
											onchange={() => aiCommit.saveAiSettings(agent.id, {}, {})}
										/>
										{agent.label}
										<span class="note">
											{agent.state === 'ready' ? (agent.version ?? 'found') : 'not found on PATH'}
										</span>
									</label>
								{/each}
							</div>
						</div>
						<div class="row">
							<span class="row-label">
								Model
								<span class="note">
									{aiAgentId === 'claude'
										? 'Passed as --model. The CLI default may be an expensive model; haiku is plenty for commits.'
										: 'The model flag of the chosen CLI; Custom takes any id it accepts.'}
								</span>
							</span>
							<div class="model-pick">
								<select
									disabled={aiAgentId === null}
									value={modelSelectValue}
									onchange={(event) => pickModelOption(event.currentTarget.value)}
								>
									{#each listModelOptions as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
								</select>
								{#if customModel}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="model"
										autofocus
										placeholder="model id"
										disabled={aiAgentId === null}
										bind:value={draftModel}
										onchange={saveAiModel}
										onkeydown={(event) => {
											if (event.key === 'Enter') saveAiModel();
										}}
									/>
								{/if}
							</div>
						</div>
						<div class="row">
							<span class="row-label">
								Thinking
								<span class="note">
									{aiAgentId === 'codex'
										? 'Reasoning effort (-c model_reasoning_effort).'
										: aiAgentId === 'claude'
											? 'Effort level (--effort). Low is plenty for commits.'
											: 'This CLI has no effort flag; it thinks as it pleases.'}
								</span>
							</span>
							<select
								disabled={aiAgentId === null || listThinkingLevels.length <= 1}
								value={aiAgentId ? (aiCommit.inventory.mapThinking[aiAgentId] ?? '') : ''}
								onchange={(event) => saveAiThinking(event.currentTarget.value)}
							>
								{#each listThinkingLevels as level (level)}
									<option value={level}>{level === '' ? 'CLI default' : level}</option>
								{/each}
							</select>
						</div>
					{/if}
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
					{listWorkspaceIdentities}
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
	.agent-choice {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
	}
	.agent-option {
		display: flex;
		align-items: baseline;
		gap: var(--gg-space-2);
		cursor: pointer;
	}
	.agent-option.disabled {
		opacity: 0.6;
		cursor: default;
	}
	.model-pick {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--gg-space-1);
	}
	input.model {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: 2px var(--gg-space-1);
		width: 170px;
	}
	input.model:focus {
		outline: 1px solid var(--vscode-focusBorder);
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
		flex-wrap: wrap;
		gap: var(--gg-space-1);
		padding: var(--gg-space-2) var(--gg-space-4);
		border-bottom: 1px solid var(--gg-border);
	}
	/* Chips, not underlines: the open tab is filled, so it reads at a glance. */
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: transparent;
		border: 1px solid var(--gg-border);
		border-radius: 999px;
		color: var(--gg-fg-muted);
		font: inherit;
		padding: 3px 12px;
		cursor: pointer;
	}
	.tabs button:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--gg-fg);
	}
	.tabs button.active {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
</style>
