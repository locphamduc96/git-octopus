<script lang="ts">
	import Modal from '../../lib/ui/Modal.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import { listPlanFiles } from '../../lib/aiCommitPlan';

	const inventory = $derived(aiCommit.inventory);
	const plan = $derived(aiCommit.plan);
	const split = $derived(plan !== null && plan.listGroups.length > 1);
	const fileCount = $derived(plan ? listPlanFiles(plan).length : 0);

	/** The commit in view on the rail. Clamped, because moving files can dissolve the group it names. */
	let activeGroup = $state(0);
	const groupCount = $derived(plan?.listGroups.length ?? 0);
	const current = $derived(Math.max(0, Math.min(activeGroup, groupCount - 1)));

	const savedAgent = $derived(
		inventory?.listAgents.find((agent) => agent.id === inventory?.savedAgentId) ?? null
	);
	const agentTag = $derived.by(() => {
		if (!savedAgent) return '';
		const model = inventory?.savedAgentId ? (inventory.mapModels[inventory.savedAgentId] ?? '') : '';
		return model ? `${savedAgent.label} · ${model}` : savedAgent.label;
	});

	/** Seconds since the generating view came up — honest enough for a "still working" signal. */
	let elapsed = $state(0);
	$effect(() => {
		if (aiCommit.phase !== 'generating') return;
		elapsed = 0;
		const timer = setInterval(() => elapsed++, 1000);
		return () => clearInterval(timer);
	});

	type StepState = 'done' | 'running' | 'pending';
	const listSteps = $derived.by((): { key: string; state: StepState; label: string; detail?: string }[] => {
		const p = aiCommit.progress;
		const stage = p?.stage ?? null;
		const counts =
			p && p.additions !== undefined ? `+${p.additions} −${p.deletions ?? 0}` : undefined;
		const writer = savedAgent ? `${savedAgent.label} is writing the plan…` : 'Writing the plan…';
		return [
			stage === null
				? { key: 'collect', state: 'running', label: 'Collecting changed files…' }
				: {
						key: 'collect',
						state: 'done',
						label: `Collected ${p?.fileCount} staged file${p?.fileCount === 1 ? '' : 's'}`,
						detail: counts,
					},
			{
				key: 'prompt',
				state: stage === 'prompted' ? 'done' : stage === 'collected' ? 'running' : 'pending',
				label:
					stage === 'prompted'
						? 'Diffs prepared & secrets redacted'
						: 'Preparing diffs & redacting secrets…',
			},
			stage === 'prompted'
				? { key: 'agent', state: 'running', label: writer, detail: `${elapsed}s` }
				: { key: 'agent', state: 'pending', label: writer },
			{ key: 'review', state: 'pending', label: 'Review & create commits' },
		];
	});
</script>

<Modal title="AI commit" wide={aiCommit.phase === 'result'} onclose={() => aiCommit.close()}>
	{#snippet headerExtra()}
		{#if aiCommit.phase === 'generating'}
			<span class="header-spacer"></span>
			{#if agentTag}<span class="count">{agentTag}</span>{/if}
		{:else if aiCommit.phase === 'result' && plan}
			<span class="count">{fileCount} file{fileCount === 1 ? '' : 's'}</span>
			<span class="header-spacer"></span>
			{#if split}
				<!-- Neutral on purpose: the one blue element in the dialog is the primary button. -->
				<div class="switch" role="radiogroup" aria-label="How to commit">
					<button
						class="seg"
						class:on={aiCommit.mode === 'split'}
						onclick={() => aiCommit.setMode('split')}
					>
						{#if aiCommit.mode === 'split'}<Icon name="check" />{/if}
						Split into {plan.listGroups.length} commits
					</button>
					<button
						class="seg"
						class:on={aiCommit.mode === 'single'}
						onclick={() => aiCommit.setMode('single')}
					>
						{#if aiCommit.mode === 'single'}<Icon name="check" />{/if}
						One commit
					</button>
				</div>
			{/if}
		{/if}
	{/snippet}
	{#snippet body()}
		{#if aiCommit.error && aiCommit.phase === 'setup'}
			<div class="state">
				<p class="error">{aiCommit.error.message}</p>
				{#if aiCommit.error.needsLogin}
					<p class="hint">
						Log in from a terminal, then try again — the login is interactive and only the CLI
						itself can run it.
					</p>
				{/if}
			</div>
		{:else if aiCommit.phase === 'setup'}
			{#if inventory === null}
				<p class="muted">Looking for agent CLIs…</p>
			{:else}
				<p class="muted">Pick the agent that will write the commit plan.</p>
				<div class="agents">
					{#each inventory.listAgents as agent (agent.id)}
						<button
							class="agent"
							disabled={agent.state !== 'ready'}
							onclick={() => aiCommit.chooseAgent(agent.id)}
						>
							<span class="agent-name">{agent.label}</span>
							<span class="agent-detail">
								{agent.state === 'ready' ? (agent.version ?? 'found') : 'not found on PATH'}
							</span>
						</button>
					{/each}
				</div>
				<p class="hint">
					Your changed files — and the diffs of code files — are sent to the chosen agent's AI
					service. Generated assets and files matching
					<code>gitOctopus.aiCommit.excludePatterns</code> are listed by name only.
				</p>
			{/if}
		{:else if aiCommit.phase === 'generating'}
			<div class="state" aria-busy="true" aria-label="Generating commit plan">
				<div class="steps">
					{#each listSteps as step (step.key)}
						<div class="step {step.state}">
							{#if step.state === 'done'}
								<span class="step-icon step-done"><Icon name="check" /></span>
							{:else if step.state === 'running'}
								<span class="step-icon step-spin"><Icon name="loading" /></span>
							{:else}
								<span class="step-icon step-wait"></span>
							{/if}
							<span class="step-label">{step.label}</span>
							{#if step.detail}<span class="step-detail">{step.detail}</span>{/if}
						</div>
					{/each}
				</div>
				<p class="hint">
					You can hide this dialog — the agent keeps running, and the result will be here when
					you reopen it.
				</p>
			</div>
		{:else if aiCommit.phase === 'result' && plan}
			{#if aiCommit.error}
				<p class="error">{aiCommit.error.message}</p>
			{/if}
			{#if aiCommit.restored}
				<p class="strip">
					<Icon name="history" />
					<span>Restored from your last run — the changed files are the same.</span>
					<button class="link" onclick={() => aiCommit.regenerate()}>
						Regenerate for a fresh plan
					</button>
				</p>
			{/if}
			{#if split && aiCommit.mode === 'split'}
				{@const group = plan.listGroups[current]}
				<div class="plan">
					<!-- The whole plan stays in view while one commit is edited. -->
					<aside class="rail">
						<div class="rail-head">Commits in this plan</div>
						{#each plan.listGroups as tab, index (index)}
							<button
								class="rail-row"
								class:on={index === current}
								role="tab"
								aria-selected={index === current}
								title={tab.subject}
								onclick={() => (activeGroup = index)}
							>
								<span class="badge">{index + 1}</span>
								<span class="rail-meta">
									<span class="rail-subject">{tab.subject.trim() || '(no subject)'}</span>
									<span class="rail-count">
										{tab.listFiles.length} file{tab.listFiles.length === 1 ? '' : 's'}
									</span>
								</span>
							</button>
						{/each}
					</aside>
					<div class="detail">
						<input
							value={group.subject}
							placeholder="Subject"
							oninput={(event) => aiCommit.setGroupSubject(current, event.currentTarget.value)}
						/>
						<textarea
							value={group.body}
							rows="6"
							placeholder="Body (optional)"
							oninput={(event) => aiCommit.setGroupBody(current, event.currentTarget.value)}
						></textarea>
						<div class="files-head">
							Files <span class="pill">{group.listFiles.length}</span>
						</div>
						<ul class="files">
							{#each group.listFiles as file (file)}
								<li>
									<Icon name="file" />
									<span class="path" title={file}>{file}</span>
									<select
										aria-label="Move {file} to another commit"
										value={String(current)}
										onchange={(event) =>
											aiCommit.moveFileTo(file, Number(event.currentTarget.value))}
									>
										{#each plan.listGroups as _, target (target)}
											<option value={String(target)}>Commit {target + 1}</option>
										{/each}
									</select>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{:else}
				<label>
					Summary
					<!-- svelte-ignore a11y_autofocus -->
					<input
						autofocus
						value={plan.single.subject}
						oninput={(event) => aiCommit.setSingleSubject(event.currentTarget.value)}
					/>
				</label>
				<label>
					Description <span class="optional">(optional)</span>
					<textarea
						value={plan.single.body}
						rows="8"
						oninput={(event) => aiCommit.setSingleBody(event.currentTarget.value)}
					></textarea>
				</label>
				<p class="hint">All {fileCount} changed file{fileCount === 1 ? '' : 's'} go into this commit.</p>
			{/if}
		{:else if aiCommit.phase === 'executing'}
			<p class="muted">Creating commits…</p>
		{:else if aiCommit.phase === 'done' && aiCommit.executed}
			{#if aiCommit.executed.error}
				<p class="error">
					Created {aiCommit.executed.committed} of {aiCommit.executed.total} commits, then:
					{aiCommit.executed.error}
				</p>
				<p class="hint">Nothing was rolled back — the created commits are real.</p>
			{:else}
				<p class="ok">
					<Icon name="check" />
					Created {aiCommit.executed.committed} commit{aiCommit.executed.committed === 1 ? '' : 's'}.
				</p>
			{/if}
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if aiCommit.phase === 'setup' && aiCommit.error}
			{#if aiCommit.error.needsLogin}
				<button class="confirm" onclick={() => aiCommit.openLoginTerminal()}>Open terminal</button>
			{/if}
			<button class="confirm" onclick={() => aiCommit.regenerate()}>Try again</button>
			<button class="cancel" onclick={() => aiCommit.close()}>Close</button>
		{:else if aiCommit.phase === 'generating'}
			<button class="cancel" onclick={() => aiCommit.close()}>Hide</button>
			<button class="quiet" onclick={() => aiCommit.cancelGenerate()}>Cancel</button>
		{:else if aiCommit.phase === 'result'}
			<span class="lead">
				<button class="confirm" onclick={() => aiCommit.execute()}>
					{aiCommit.mode === 'split' && plan ? `Create ${plan.listGroups.length} commits` : 'Commit'}
				</button>
				<button class="cancel" onclick={() => aiCommit.regenerate()}>Regenerate</button>
			</span>
			<button class="quiet" onclick={() => aiCommit.close()}>Cancel</button>
		{:else if aiCommit.phase === 'done'}
			<button class="confirm" onclick={() => aiCommit.close()}>Close</button>
		{:else}
			<button class="cancel" onclick={() => aiCommit.close()}>Cancel</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.state {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
	}
	.muted {
		margin: 0;
		color: var(--gg-fg-muted);
	}
	.error {
		margin: 0;
		color: var(--vscode-errorForeground, #f48771);
	}
	.ok {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
	}
	.hint {
		margin: 0;
		color: var(--gg-fg-muted);
		font-size: 0.8em;
	}
	code {
		font-family: var(--vscode-editor-font-family, monospace);
	}
	.count {
		color: var(--gg-fg-muted);
		flex: none;
	}
	.header-spacer {
		flex: 1;
	}
	.switch {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--vscode-input-background);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius-item);
	}
	.seg {
		display: inline-flex;
		align-items: center;
		gap: var(--gg-space-1);
		padding: 1px 10px;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--gg-fg-muted);
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
		white-space: nowrap;
	}
	.seg:hover:not(.on) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.seg.on {
		background: color-mix(in srgb, var(--gg-fg) 16%, transparent);
		color: var(--gg-fg);
	}
	.strip {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin: 0;
		padding: var(--gg-space-1) var(--gg-space-2);
		border-radius: var(--gg-radius-item);
		background: color-mix(in srgb, var(--gg-accent) 8%, transparent);
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	.strip :global(.codicon) {
		color: var(--gg-accent);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--gg-accent);
		cursor: pointer;
		white-space: nowrap;
	}
	.link:hover {
		text-decoration: underline;
	}
	.agents {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
	}
	.agent {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--gg-space-2);
		padding: var(--gg-space-2) var(--gg-space-3);
		border: 1px solid var(--gg-border);
		border-radius: 4px;
		background: transparent;
		color: var(--gg-fg);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.agent:hover:not(:disabled) {
		background: var(--vscode-toolbar-hoverBackground);
	}
	.agent:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.agent-name {
		font-weight: 600;
	}
	.agent-detail {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--gg-space-1) 0;
	}
	.step {
		display: flex;
		align-items: center;
		gap: var(--gg-space-3);
		padding: var(--gg-space-1) 0;
	}
	.step.running {
		color: var(--gg-fg);
	}
	.step.pending {
		color: var(--gg-fg-muted);
	}
	.step-icon {
		flex: none;
		width: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.step-done :global(.codicon) {
		color: var(--vscode-testing-iconPassed, #3fb950);
	}
	.step-spin :global(.codicon) {
		color: var(--gg-accent);
		animation: gg-step-spin 1s linear infinite;
	}
	@keyframes gg-step-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.step-wait {
		width: 13px;
		height: 13px;
		margin: 0 1.5px;
		box-sizing: border-box;
		border: 1.5px solid var(--gg-border);
		border-radius: 50%;
	}
	.step-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.step-detail {
		margin-left: auto;
		color: var(--gg-fg-muted);
		font-size: 0.85em;
	}
	/* Master–detail: the rail keeps the whole plan in view while one commit is edited. */
	.plan {
		display: flex;
		min-height: 280px;
		border: 1px solid var(--gg-border);
		border-radius: 4px;
		overflow: hidden;
	}
	.rail {
		width: 240px;
		flex: none;
		display: flex;
		flex-direction: column;
		padding: var(--gg-space-2) 0;
		border-right: 1px solid var(--gg-border);
		background: rgba(0, 0, 0, 0.12);
		overflow-y: auto;
	}
	.rail-head {
		padding: 0 var(--gg-space-3) var(--gg-space-2);
		color: var(--gg-fg-muted);
		font-size: 0.75em;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rail-row {
		display: flex;
		gap: var(--gg-space-2);
		align-items: flex-start;
		padding: var(--gg-space-2) var(--gg-space-3);
		border: none;
		background: transparent;
		color: var(--gg-fg);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.rail-row:hover:not(.on) {
		background: var(--vscode-list-hoverBackground);
	}
	.rail-row.on {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.badge {
		flex: none;
		width: 18px;
		height: 18px;
		margin-top: 1px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: color-mix(in srgb, currentColor 16%, transparent);
		font-size: 0.85em;
	}
	.rail-meta {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.rail-subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rail-count {
		font-size: 0.85em;
		opacity: 0.75;
	}
	.detail {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3);
	}
	.files-head {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		margin-top: var(--gg-space-1);
		color: var(--gg-fg-muted);
		font-size: 0.75em;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.pill {
		padding: 0 6px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--gg-fg) 12%, transparent);
		text-transform: none;
		letter-spacing: 0;
	}
	.files {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 32vh;
		overflow: auto;
	}
	.files li {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: 3px var(--gg-space-2);
		border-radius: var(--gg-radius-item);
		font-size: 0.9em;
	}
	.files li:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.files li :global(.codicon) {
		color: var(--gg-fg-muted);
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.95em;
	}
	select {
		background: var(--vscode-dropdown-background, var(--vscode-input-background));
		color: var(--gg-fg-muted);
		border: 1px solid var(--vscode-dropdown-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		font-size: 0.85em;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		color: var(--gg-fg-muted);
		font-size: 0.9em;
	}
	.optional {
		opacity: 0.7;
	}
	input,
	textarea {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, var(--gg-border));
		border-radius: 3px;
		font: inherit;
		padding: var(--gg-space-1) var(--gg-space-2);
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: 1px solid var(--vscode-focusBorder);
	}
	/* Primary and Regenerate travel together; Cancel sits alone at the far edge. */
	.lead {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
	}
	.confirm,
	.cancel {
		border: none;
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-4);
	}
	.confirm {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.confirm:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.cancel {
		background: var(--vscode-button-secondaryBackground, transparent);
		color: var(--vscode-button-secondaryForeground, var(--gg-fg));
		border: 1px solid var(--gg-border);
	}
	.quiet {
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--gg-fg-muted);
		font: inherit;
		cursor: pointer;
		padding: var(--gg-space-1) var(--gg-space-3);
	}
	.quiet:hover {
		color: var(--gg-fg);
		background: var(--vscode-toolbar-hoverBackground);
	}
</style>
