<script lang="ts">
	import RemotesSection from './RemotesSection.svelte';
	import SigningSection from './SigningSection.svelte';
	import { signing } from '../../lib/stores/signing.svelte';
	import { capabilities } from '../../lib/stores/capabilities.svelte';
	import WorktreesSection from './WorktreesSection.svelte';
	import { worktrees } from '../../lib/stores/worktrees.svelte';
	import { remotes } from '../../lib/stores/remotes.svelte';
	import type {
		AgentId,
		CommitOrder,
		GitIdentity,
		WorkspaceIdentityEntry,
	} from '@git-octopus/shared';
	import { LIST_AUTO_FETCH_MINUTES } from '@git-octopus/shared';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import SelectField from '../../lib/ui/SelectField.svelte';
	import { tooltip } from '../../lib/ui/tooltip';
	import IdentitySection from './IdentitySection.svelte';
	import PresetPicker, { CUSTOM, type PresetOption } from './PresetPicker.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import {
		LIST_COMMIT_ORDERS,
		branchesPanelShown,
		LIST_DATE_TYPES,
		LIST_DIFF_TARGETS,
		LIST_EXTERNAL_EDITORS,
		LIST_GRAPH_STYLES,
		LIST_PULL_STRATEGIES,
		LIST_TERMINAL_APPS,
		LIST_THEME_CHOICES,
		MAP_EXTERNAL_EDITOR_LABEL,
		MAP_PULL_STRATEGY_LABEL,
		MAP_THEME_LABEL,
		pickOption,
		type RepoIdentityState,
		type ViewSettings,
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
	/** The long story behind a setting's one-line note, shown from its ⓘ. */
	const PULL_STRATEGY_DETAIL =
		'"Follow git config" is a plain git pull — this repository\'s pull.ff and pull.rebase decide. The others say so on the command line, so a repository set to write a merge commit on every pull can still be pulled clean. The Pull menu ⌄ offers each one for a single pull.';
	const AUTO_FETCH_DETAIL =
		'Your checked-out branch does not move. Pauses while the window is in the background or a merge is unresolved, and stops itself after repeated failures rather than asking for a password again and again.';
	/**
	 * Labels only — the options themselves are rendered from `LIST_COMMIT_ORDERS`, the same list the
	 * onchange handler validates against. A `Record` keyed by the union means an order added to it
	 * fails to compile here rather than rendering an option that then refuses to apply.
	 */
	const mapOrderLabel: Record<CommitOrder, string> = {
		date: 'Commit date',
		authorDate: 'Author date',
		topo: 'Topological',
	};

	function set<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
		onchange({ ...settings, [key]: value });
	}

	type Tab =
		'general' | 'graph' | 'commits' | 'ai' | 'identity' | 'signing' | 'remotes' | 'worktrees';
	const listTabs: { id: Tab; label: string; icon: string }[] = [
		{ id: 'general', label: 'General', icon: 'settings-gear' },
		{ id: 'graph', label: 'Graph', icon: 'git-branch' },
		{ id: 'commits', label: 'Commits & Dates', icon: 'git-commit' },
		{ id: 'ai', label: 'AI commit', icon: 'sparkle' },
		{ id: 'identity', label: 'Identity', icon: 'account' },
		{ id: 'signing', label: 'Signing', icon: 'verified' },
		{ id: 'remotes', label: 'Remotes', icon: 'cloud' },
		{ id: 'worktrees', label: 'Worktrees', icon: 'folder-library' },
	];
	let tab = $state<Tab>('general');
	const tabLabel = $derived(listTabs.find((item) => item.id === tab)?.label ?? '');

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
	const LIST_FALLBACK_MODELS: PresetOption[] = [
		{ value: '', label: 'CLI default' },
		{ value: CUSTOM, label: 'Custom…' },
	];
	const mapModelOptions: Partial<Record<AgentId, PresetOption[]>> = {
		claude: [
			{ value: '', label: 'CLI default' },
			{ value: 'haiku', label: 'haiku — cheapest, plenty for commits' },
			{ value: 'sonnet', label: 'sonnet' },
			{ value: 'opus', label: 'opus' },
			{ value: 'fable', label: 'fable — most capable, expensive' },
			{ value: CUSTOM, label: 'Custom…' },
		],
		codex: [
			{ value: '', label: 'CLI default' },
			{ value: 'gpt-5.6-luna', label: 'gpt-5.6-luna — cheap, high-volume' },
			{ value: 'gpt-5.6-terra', label: 'gpt-5.6-terra — everyday workhorse' },
			{ value: 'gpt-5.6-sol', label: 'gpt-5.6-sol — frontier, expensive' },
			{ value: CUSTOM, label: 'Custom… (e.g. a custom provider model)' },
		],
		gemini: [
			{ value: '', label: 'CLI default' },
			{ value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite — cheapest' },
			{ value: 'gemini-3.5-flash', label: 'gemini-3.5-flash — everyday' },
			{ value: 'gemini-3.1-pro', label: 'gemini-3.1-pro — flagship' },
			{ value: CUSTOM, label: 'Custom…' },
		],
	};

	const aiAgentId = $derived(aiCommit.inventory?.savedAgentId ?? null);
	const listModelOptions = $derived(
		(aiAgentId ? mapModelOptions[aiAgentId] : undefined) ?? LIST_FALLBACK_MODELS
	);
	const listThinkingLevels = $derived(
		(aiAgentId ? mapThinkingOptions[aiAgentId] : undefined) ?? ['']
	);
	/**
	 * The chips carry the short name only; the trailing "— why you'd pick it" is guidance for the
	 * list, not a label that fits on a pill.
	 */
	const listModelChips = $derived(
		listModelOptions.map((option) => ({
			value: option.value,
			label: option.value === '' ? 'CLI default' : option.label.split(' — ')[0],
		}))
	);
	// One level means the CLI has no effort flag; the note says so and there is nothing to pick.
	const listThinkingChips = $derived(
		listThinkingLevels.length > 1
			? listThinkingLevels.map((level) => ({
					value: level,
					label: level === '' ? 'CLI default' : level,
				}))
			: []
	);
	/**
	 * Each picker reads its own setting through a derived of its own, never the inventory object.
	 * That is what keeps a half-typed custom entry alive across a broadcast that did not touch this
	 * setting: a derived recomputing to the value it already held notifies nobody, so the picker's
	 * own draft is left standing. Handing the inventory down instead would drop the draft on every
	 * save of any other setting.
	 */
	const savedModel = $derived(aiAgentId ? (aiCommit.inventory?.mapModels[aiAgentId] ?? '') : '');
	const savedThinking = $derived(
		aiAgentId ? (aiCommit.inventory?.mapThinking[aiAgentId] ?? '') : ''
	);
	const savedLanguage = $derived(aiCommit.inventory?.language ?? '');

	/** Presets plus an escape hatch — any language the agent understands is a valid answer. */
	const LIST_LANGUAGE_OPTIONS: PresetOption[] = [
		{ value: '', label: 'Match history' },
		{ value: 'English', label: 'English' },
		{ value: 'Vietnamese', label: 'Tiếng Việt' },
		{ value: CUSTOM, label: 'Custom…' },
	];

	function openTab(next: Tab): void {
		tab = next;
		if (next === 'ai') aiCommit.loadInventory();
		if (next === 'signing') signing.load();
		if (next === 'remotes') remotes.load();
		if (next === 'worktrees') worktrees.load();
	}

	function saveAiModel(value: string): void {
		if (aiAgentId) aiCommit.saveAiSettings({ mapModels: { [aiAgentId]: value } });
	}

	function saveAiThinking(value: string): void {
		if (aiAgentId) aiCommit.saveAiSettings({ mapThinking: { [aiAgentId]: value } });
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

		<div class="main">
			<!-- The category rail: every section stays in view, the open one reads as selected. -->
			<div class="nav" role="tablist" aria-orientation="vertical">
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
				<h3 class="content-title">{tabLabel}</h3>
				{#if tab === 'general'}
					<section class="gg-block">
						<div class="row">
							<span class="row-label">Commits to load</span>
							<SelectField
								value={String(settings.commitLimit)}
								onchange={(event) => set('commitLimit', Number(event.currentTarget.value))}
							>
								{#each listLimits as limit (limit)}
									<option value={String(limit)}>{limit}</option>
								{/each}
							</SelectField>
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
						{#if capabilities.editorDiff}
							<div class="row">
								<span class="row-label">
									Open diffs in
									<span class="note"
										>Review inside this view, or open an editor tab.<span
											class="info"
											role="img"
											aria-label="The panel keeps the review inside this view, without opening tabs. Changes-only or whole-file is chosen in the panel's own header."
											use:tooltip={"The panel keeps the review inside this view, without opening tabs. Changes-only or whole-file is chosen in the panel's own header."}
											><Icon name="info" /></span
										></span
									>
								</span>
								<SelectField
									value={settings.diffTarget}
									onchange={(event) => {
										const picked = pickOption(LIST_DIFF_TARGETS, event.currentTarget.value);
										if (picked) set('diffTarget', picked);
									}}
								>
									<option value="editor">VS Code editor</option>
									<option value="panel">Git Octopus panel</option>
								</SelectField>
							</div>
						{/if}
						<div class="row">
							<span class="row-label">
								Highlight changed words
								<span class="note">
									Inside an edited line, mark the words that changed — not only the whole line.
								</span>
							</span>
							<input
								type="checkbox"
								checked={settings.diffIntraline}
								onchange={(event) => set('diffIntraline', event.currentTarget.checked)}
							/>
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
								Show branches panel
								<span class="note"
									>Branches, remotes, tags, stashes, worktrees and submodules beside the graph.</span
								>
							</span>
							<input
								type="checkbox"
								aria-label="Show branches panel"
								checked={branchesPanelShown(settings, capabilities.desktop)}
								onchange={(event) => set('showBranchesPanel', event.currentTarget.checked)}
							/>
						</div>
						<div class="row">
							<span class="row-label">
								Fast-forward on checkout
								<span class="note"
									>Update a branch that has only fallen behind its remote.<span
										class="info"
										role="img"
										aria-label="Never runs on a branch with commits of its own, or while you have uncommitted changes."
										use:tooltip={'Never runs on a branch with commits of its own, or while you have uncommitted changes.'}
										><Icon name="info" /></span
									></span
								>
							</span>
							<input
								type="checkbox"
								checked={settings.autoFastForwardOnCheckout}
								onchange={(event) => set('autoFastForwardOnCheckout', event.currentTarget.checked)}
							/>
						</div>
						<div class="row">
							<span class="row-label">
								Pull strategy
								<span class="note"
									>What the Pull button runs.<span
										class="info"
										role="img"
										aria-label={PULL_STRATEGY_DETAIL}
										use:tooltip={PULL_STRATEGY_DETAIL}><Icon name="info" /></span
									></span
								>
							</span>
							<SelectField
								value={settings.pullStrategy}
								onchange={(event) =>
									set(
										'pullStrategy',
										pickOption(LIST_PULL_STRATEGIES, event.currentTarget.value) ?? 'config'
									)}
							>
								{#each LIST_PULL_STRATEGIES as strategy (strategy)}
									<option value={strategy}>{MAP_PULL_STRATEGY_LABEL[strategy]}</option>
								{/each}
							</SelectField>
						</div>
						<div class="row">
							<span class="row-label">
								Auto-fetch
								<span class="note"
									>Keeps the drift on branch chips true. Never pulls.<span
										class="info"
										role="img"
										aria-label={AUTO_FETCH_DETAIL}
										use:tooltip={AUTO_FETCH_DETAIL}><Icon name="info" /></span
									></span
								>
							</span>
							<SelectField
								value={String(settings.autoFetchMinutes)}
								onchange={(event) => set('autoFetchMinutes', Number(event.currentTarget.value))}
							>
								{#each LIST_AUTO_FETCH_MINUTES as minutes (minutes)}
									<option value={String(minutes)}
										>{minutes === 0 ? 'Never' : `Every ${minutes} min`}</option
									>
								{/each}
							</SelectField>
						</div>
					</section>
					{#if capabilities.desktop}
						<h4 class="block-title">Desktop</h4>
						<section class="gg-block" aria-label="Desktop">
							<div class="row">
								<span class="row-label">
									Theme
									<span class="note">Follow macOS, or stay light or dark.</span>
								</span>
								<SelectField
									aria-label="Theme"
									value={settings.theme}
									onchange={(event) =>
										set(
											'theme',
											pickOption(LIST_THEME_CHOICES, event.currentTarget.value) ?? 'system'
										)}
								>
									{#each LIST_THEME_CHOICES as theme (theme)}
										<option value={theme}>{MAP_THEME_LABEL[theme]}</option>
									{/each}
								</SelectField>
							</div>
							<div class="row">
								<span class="row-label">
									Git path
									<span class="note">Empty runs the git found on your PATH.</span>
								</span>
								<input
									class="text-field"
									type="text"
									aria-label="Git path"
									placeholder="git"
									spellcheck="false"
									autocomplete="off"
									value={settings.gitPath}
									onchange={(event) => set('gitPath', event.currentTarget.value.trim())}
								/>
							</div>
							<div class="row">
								<span class="row-label">
									External editor
									<span class="note">Where "Open File" and conflicted files open.</span>
								</span>
								<SelectField
									aria-label="External editor"
									value={settings.externalEditor}
									onchange={(event) =>
										set(
											'externalEditor',
											pickOption(LIST_EXTERNAL_EDITORS, event.currentTarget.value) ?? 'auto'
										)}
								>
									{#each LIST_EXTERNAL_EDITORS as editor (editor)}
										<option value={editor}>{MAP_EXTERNAL_EDITOR_LABEL[editor]}</option>
									{/each}
								</SelectField>
							</div>
							{#if settings.externalEditor === 'custom'}
								<div class="row">
									<span class="row-label">
										Editor command
										<span class="note">
											<code>{'{file}'}</code> stands for the file's path; without it the path goes last.
										</span>
									</span>
									<input
										class="text-field"
										type="text"
										aria-label="Editor command"
										placeholder={'subl --wait {file}'}
										spellcheck="false"
										autocomplete="off"
										value={settings.externalEditorCommand}
										onchange={(event) => set('externalEditorCommand', event.currentTarget.value)}
									/>
								</div>
							{/if}
							<div class="row">
								<span class="row-label">
									Terminal app
									<span class="note">What "Open in terminal" launches.</span>
								</span>
								<SelectField
									aria-label="Terminal app"
									value={settings.terminalApp}
									onchange={(event) =>
										set(
											'terminalApp',
											pickOption(LIST_TERMINAL_APPS, event.currentTarget.value) ?? 'Terminal'
										)}
								>
									{#each LIST_TERMINAL_APPS as app (app)}
										<option value={app}>{app}</option>
									{/each}
								</SelectField>
							</div>
						</section>
					{/if}
				{:else if tab === 'graph'}
					<section class="gg-block">
						<div class="row">
							<span class="row-label">Graph style</span>
							<SelectField
								value={settings.graphStyle}
								onchange={(event) => {
									const picked = pickOption(LIST_GRAPH_STYLES, event.currentTarget.value);
									if (picked) set('graphStyle', picked);
								}}
							>
								<option value="rounded">Rounded</option>
								<option value="curved">Curved</option>
								<option value="angular">Angular</option>
								<option value="diagonal">Diagonal</option>
							</SelectField>
						</div>
						<div class="row">
							<span class="row-label">
								Row height
								<span class="note">How much space each commit row takes.</span>
							</span>
							<!-- Pictures, not words: the three densities drawn as the rows they produce. -->
							<div class="swatches" role="radiogroup" aria-label="Row height">
								<button
									class="swatch"
									class:on={settings.rowDensity === 'compact'}
									title="Compact"
									role="radio"
									aria-checked={settings.rowDensity === 'compact'}
									onclick={() => set('rowDensity', 'compact')}
								>
									<svg width="34" height="26" viewBox="0 0 56 40" fill="none" aria-hidden="true">
										<g fill="currentColor">
											<circle cx="8" cy="6" r="2.6" /><circle cx="8" cy="15" r="2.6" />
											<circle cx="8" cy="24" r="2.6" /><circle cx="8" cy="33" r="2.6" />
										</g>
										<g stroke="currentColor" stroke-width="3" opacity="0.45">
											<path d="M16 6h32M16 15h24M16 24h29M16 33h20" />
										</g>
									</svg>
								</button>
								<button
									class="swatch"
									class:on={settings.rowDensity === 'comfortable'}
									title="Comfortable"
									role="radio"
									aria-checked={settings.rowDensity === 'comfortable'}
									onclick={() => set('rowDensity', 'comfortable')}
								>
									<svg width="34" height="26" viewBox="0 0 56 40" fill="none" aria-hidden="true">
										<g fill="currentColor">
											<circle cx="8" cy="8" r="3" /><circle cx="8" cy="20" r="3" />
											<circle cx="8" cy="32" r="3" />
										</g>
										<g stroke="currentColor" stroke-width="3.4" opacity="0.45">
											<path d="M16 8h32M16 20h24M16 32h29" />
										</g>
									</svg>
								</button>
								<button
									class="swatch"
									class:on={settings.rowDensity === 'spacious'}
									title="Spacious"
									role="radio"
									aria-checked={settings.rowDensity === 'spacious'}
									onclick={() => set('rowDensity', 'spacious')}
								>
									<svg width="34" height="26" viewBox="0 0 56 40" fill="none" aria-hidden="true">
										<g fill="currentColor">
											<circle cx="8" cy="11" r="3.6" /><circle cx="8" cy="29" r="3.6" />
										</g>
										<g stroke="currentColor" stroke-width="4" opacity="0.45">
											<path d="M16 11h32M16 29h26" />
										</g>
									</svg>
								</button>
							</div>
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
									The feat / fix / chore chip, and the merge chip. When off, `feat:` reads as part
									of the subject.
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
					<section class="gg-block">
						<div class="row">
							<span class="row-label">
								Commit ordering
								<span class="note">Topological keeps a branch's commits together.</span>
							</span>
							<SelectField
								value={settings.commitOrder}
								onchange={(event) => {
									const picked = pickOption(LIST_COMMIT_ORDERS, event.currentTarget.value);
									if (picked) set('commitOrder', picked);
								}}
							>
								{#each LIST_COMMIT_ORDERS as order (order)}
									<option value={order}>{mapOrderLabel[order]}</option>
								{/each}
							</SelectField>
						</div>
						<div class="row">
							<span class="row-label">Date column shows</span>
							<SelectField
								value={settings.dateType}
								onchange={(event) => {
									const picked = pickOption(LIST_DATE_TYPES, event.currentTarget.value);
									if (picked) set('dateType', picked);
								}}
							>
								<option value="commit">Commit date</option>
								<option value="author">Author date</option>
							</SelectField>
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
							<span class="row-label">
								Show upstream drift on branch chips
								<span class="note"
									>How far each local branch is ahead of or behind its upstream.<span
										class="info"
										role="img"
										aria-label="Measured against what your last fetch brought in, not against the remote right now."
										use:tooltip={'Measured against what your last fetch brought in, not against the remote right now.'}
										><Icon name="info" /></span
									></span
								>
							</span>
							<input
								type="checkbox"
								checked={settings.showTrackingBadges}
								onchange={(event) => set('showTrackingBadges', event.currentTarget.checked)}
							/>
						</div>
						<div class="row">
							<span class="row-label">
								Name the lane of a commit with no ref
								<span class="note">
									Selecting or hovering a commit that carries no branch or tag shows, faintly, the
									branch line it is drawn on.
								</span>
							</span>
							<input
								type="checkbox"
								checked={settings.showGhostBranch}
								onchange={(event) => set('showGhostBranch', event.currentTarget.checked)}
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
					<section class="gg-block">
						{#if !aiCommit.inventory}
							<p class="note">Looking for agent CLIs…</p>
						{:else}
							<p class="note">
								Which CLI writes the AI commit plan. Picking one also records your consent to
								sending the diff to it.
							</p>
							<!-- The machine state at a glance: every CLI a card, ready or not. -->
							<div class="agent-grid" role="radiogroup" aria-label="AI commit agent">
								{#each aiCommit.inventory.listAgents as agent (agent.id)}
									<button
										class="agent-card"
										class:on={aiAgentId === agent.id}
										disabled={agent.state !== 'ready'}
										role="radio"
										aria-checked={aiAgentId === agent.id}
										onclick={() => aiCommit.saveAiSettings({ agentId: agent.id })}
									>
										{#if aiAgentId === agent.id}
											<span class="agent-check"><Icon name="check" /></span>
										{/if}
										<span class="agent-name">{agent.label}</span>
										<span class="agent-version">
											{agent.state === 'ready' ? (agent.version ?? 'found') : '—'}
										</span>
										<span class="agent-state" class:ready={agent.state === 'ready'}>
											<span class="dot"></span>
											{agent.state === 'ready' ? 'ready' : 'not found on PATH'}
										</span>
									</button>
								{/each}
							</div>

							<PresetPicker
								label="Model"
								listOptions={listModelChips}
								value={savedModel}
								disabled={aiAgentId === null}
								customPlaceholder="model id"
								onsave={saveAiModel}
							>
								{#snippet note()}
									— {aiAgentId === 'claude'
										? 'passed as --model; haiku is plenty for commits'
										: 'the model flag of the chosen CLI; Custom takes any id it accepts'}
								{/snippet}
							</PresetPicker>

							<PresetPicker
								label="Language"
								ariaLabel="Commit language"
								listOptions={LIST_LANGUAGE_OPTIONS}
								value={savedLanguage}
								customPlaceholder="language, e.g. Japanese"
								onsave={(value) => aiCommit.saveAiSettings({ language: value })}
							>
								{#snippet note()}
									— what the subjects and bodies are written in. Match history follows the
									repository's recent commits; the type prefix (feat:, fix:) stays English.
								{/snippet}
							</PresetPicker>

							<PresetPicker
								label="Thinking"
								listOptions={listThinkingChips}
								value={savedThinking}
								disabled={aiAgentId === null}
								onsave={saveAiThinking}
							>
								{#snippet note()}
									— {aiAgentId === 'codex'
										? 'reasoning effort (-c model_reasoning_effort)'
										: aiAgentId === 'claude'
											? 'effort level (--effort); low is plenty for commits'
											: 'this CLI has no effort flag; it thinks as it pleases'}
								{/snippet}
							</PresetPicker>
						{/if}
					</section>
				{:else if tab === 'identity'}
					<IdentitySection
						{identity}
						{listIdentities}
						{listWorkspaceIdentities}
						{suggestedIdentity}
						{onapplyIdentity}
						{onclearIdentityOverride}
						{onsaveIdentities}
					/>
					<!-- A set-and-forget switch, so it trails the identities it acts on. -->
					<section class="gg-block">
						<div class="row">
							<span class="row-label">
								Auto-apply identity by remote
								<span class="note"
									>Apply the one saved identity that matches a repository's remotes.<span
										class="info"
										role="img"
										aria-label="Only when the repository has no identity override and exactly one saved identity matches; ambiguous matches only warn."
										use:tooltip={'Only when the repository has no identity override and exactly one saved identity matches; ambiguous matches only warn.'}
										><Icon name="info" /></span
									></span
								>
							</span>
							<input
								type="checkbox"
								checked={settings.autoApplyIdentity}
								onchange={(event) => set('autoApplyIdentity', event.currentTarget.checked)}
							/>
						</div>
					</section>
				{:else if tab === 'signing'}
					<SigningSection
						showSignatures={settings.showSignatures}
						onshowSignatures={(on) => set('showSignatures', on)}
					/>
				{:else if tab === 'remotes'}
					<RemotesSection />
				{:else}
					<WorktreesSection />
				{/if}
			</div>
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
		background: var(--gg-scrim);
	}
	.panel {
		display: flex;
		flex-direction: column;
		width: min(820px, 100%);
		/* Fixed, not content-sized: switching categories must not resize the dialog. */
		height: min(560px, 100%);
		background: var(--gg-bg-overlay);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius-xl);
		box-shadow: var(--gg-shadow);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex: none;
		height: var(--gg-dialog-head-h);
		box-sizing: border-box;
		font-weight: 600;
		font-size: var(--gg-text-lg);
		padding: 0 var(--gg-space-2) 0 var(--gg-space-4);
		border-bottom: 1px solid var(--gg-seam);
	}
	.main {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.content {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: var(--gg-space-3) var(--gg-space-4) var(--gg-space-4);
	}
	.content-title {
		margin: 0 0 var(--gg-space-2);
		font-size: var(--gg-text-md);
		font-weight: 600;
	}
	/* A group's name, between two blocks of one page. */
	.block-title {
		margin: var(--gg-space-4) 0 var(--gg-space-2);
		font-size: var(--gg-text-sm);
		font-weight: 600;
		color: var(--gg-fg-muted);
	}
	.text-field {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		height: var(--gg-control-h);
		padding: 0 var(--gg-space-2);
		background: var(--gg-input-bg);
		color: var(--gg-input-fg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
		font: inherit;
	}
	.text-field:focus {
		outline: 1px solid var(--gg-focus);
		outline-offset: -1px;
	}
	.note code {
		font-family: var(--gg-font-mono);
		font-size: inherit;
	}
	section {
		display: flex;
		flex-direction: column;
	}
	/* Label left, every control in one 220px column on the right; the page's block groups the rows. */
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		align-items: center;
		gap: var(--gg-space-4);
		padding: var(--gg-space-3) 0;
	}
	.row-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.row > input[type='checkbox'] {
		justify-self: start;
	}
	/* Sits on the note's last line, after its full stop; the long version is in its tooltip. */
	.info {
		display: inline-flex;
		vertical-align: -2px;
		margin-left: var(--gg-space-1);
		color: var(--gg-fg-muted);
		cursor: help;
	}
	.info :global(.codicon) {
		font-size: var(--gg-icon-xs);
	}
	.note {
		margin: 0;
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
	}
	/* The density (and later style) pickers: small pictures where the dropdown used to sit. */
	.swatches {
		display: flex;
		gap: var(--gg-space-1);
		flex: none;
	}
	.swatch {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 6px;
		background: transparent;
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		color: var(--gg-fg-muted);
		cursor: pointer;
	}
	.swatch:hover:not(.on) {
		background: var(--gg-bg-tool-hover);
		color: var(--gg-fg);
	}
	.swatch.on {
		border-color: var(--gg-accent);
		background: color-mix(in srgb, var(--gg-accent) 8%, transparent);
		color: var(--gg-fg);
	}
	.agent-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--gg-space-2);
		padding: var(--gg-space-1) 0 var(--gg-space-2);
	}
	.agent-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--gg-space-2) var(--gg-space-3);
		background: transparent;
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		color: var(--gg-fg);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.agent-card:hover:not(:disabled):not(.on) {
		background: var(--gg-bg-tool-hover);
	}
	.agent-card.on {
		border-color: var(--gg-accent);
		background: color-mix(in srgb, var(--gg-accent) 6%, transparent);
	}
	.agent-card:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.agent-check {
		position: absolute;
		top: var(--gg-space-2);
		right: var(--gg-space-2);
		color: var(--gg-accent);
	}
	.agent-name {
		font-weight: 600;
	}
	.agent-version {
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
	}
	.agent-state {
		display: flex;
		align-items: center;
		gap: 5px;
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-xs);
	}
	.agent-state .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--gg-fg-muted);
	}
	.agent-state.ready {
		color: var(--gg-success);
	}
	.agent-state.ready .dot {
		background: var(--gg-success);
	}
	.nav {
		width: 190px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--gg-space-2);
		border-right: 1px solid var(--gg-seam);
		background: var(--gg-bg-raised);
		overflow-y: auto;
	}
	.nav button {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		background: transparent;
		border: none;
		border-radius: var(--gg-radius);
		color: var(--gg-fg-muted);
		font: inherit;
		padding: 5px 10px;
		cursor: pointer;
		text-align: left;
	}
	.nav button:hover:not(.active) {
		background: var(--gg-bg-hover);
		color: var(--gg-fg);
	}
	.nav button.active {
		background: var(--gg-bg-selected);
		color: var(--gg-fg-selected);
	}
</style>
