<script lang="ts">
	import Modal from '../../lib/ui/Modal.svelte';
	import Icon from '../../lib/ui/Icon.svelte';
	import { aiCommit } from '../../lib/stores/aiCommit.svelte';
	import { listPlanFiles } from '../../lib/aiCommitPlan';

	const inventory = $derived(aiCommit.inventory);
	const plan = $derived(aiCommit.plan);
	const split = $derived(plan !== null && plan.listGroups.length > 1);
	const fileCount = $derived(plan ? listPlanFiles(plan).length : 0);

	const title = $derived(
		aiCommit.phase === 'result'
			? `AI commit — ${fileCount} file${fileCount === 1 ? '' : 's'}`
			: 'AI commit'
	);
</script>

<Modal {title} onclose={() => aiCommit.close()}>
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
				<p class="muted">Generating commit plan…</p>
				<div class="skeleton">
					{#each [72, 48, 90, 60, 34] as width, i (i)}
						<span class="gg-skeleton-bar line" style="width:{width}%"></span>
					{/each}
					<span class="gg-shimmer"></span>
				</div>
			</div>
		{:else if aiCommit.phase === 'result' && plan}
			{#if aiCommit.error}
				<p class="error">{aiCommit.error.message}</p>
			{/if}
			{#if split}
				<div class="modes" role="radiogroup" aria-label="How to commit">
					<button
						class="mode"
						class:on={aiCommit.mode === 'split'}
						onclick={() => aiCommit.setMode('split')}
					>
						Split into {plan.listGroups.length} commits
					</button>
					<button
						class="mode"
						class:on={aiCommit.mode === 'single'}
						onclick={() => aiCommit.setMode('single')}
					>
						One commit
					</button>
				</div>
			{/if}
			{#if split && aiCommit.mode === 'split'}
				<div class="groups">
					{#each plan.listGroups as group, index (index)}
						<section class="group">
							<header>Commit {index + 1} · {group.listFiles.length} file{group.listFiles.length === 1 ? '' : 's'}</header>
							<input
								value={group.subject}
								placeholder="Subject"
								oninput={(event) => aiCommit.setGroupSubject(index, event.currentTarget.value)}
							/>
							<textarea
								value={group.body}
								rows="2"
								placeholder="Body (optional)"
								oninput={(event) => aiCommit.setGroupBody(index, event.currentTarget.value)}
							></textarea>
							<ul>
								{#each group.listFiles as file (file)}
									<li>
										<span class="path" title={file}>{file}</span>
										{#if plan.listGroups.length > 1}
											<select
												aria-label="Move {file} to another commit"
												value={String(index)}
												onchange={(event) =>
													aiCommit.moveFileTo(file, Number(event.currentTarget.value))}
											>
												{#each plan.listGroups as _, target (target)}
													<option value={String(target)}>Commit {target + 1}</option>
												{/each}
											</select>
										{/if}
									</li>
								{/each}
							</ul>
						</section>
					{/each}
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
						rows="5"
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
			<button class="cancel" onclick={() => aiCommit.close()}>Cancel</button>
		{:else if aiCommit.phase === 'result'}
			<button class="confirm" onclick={() => aiCommit.execute()}>
				{aiCommit.mode === 'split' && plan ? `Create ${plan.listGroups.length} commits` : 'Commit'}
			</button>
			<button class="cancel" onclick={() => aiCommit.regenerate()}>Regenerate</button>
			<button class="cancel" onclick={() => aiCommit.close()}>Cancel</button>
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
	.skeleton {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		overflow: hidden;
		padding: var(--gg-space-1) 0;
	}
	.skeleton .line {
		height: 0.9em;
	}
	.modes {
		display: flex;
		gap: var(--gg-space-1);
	}
	.mode {
		padding: 2px 10px;
		border: 1px solid var(--gg-border);
		border-radius: 3px;
		background: transparent;
		color: var(--gg-fg);
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
	}
	.mode.on {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}
	.groups {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-3);
		max-height: 50vh;
		overflow: auto;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		padding: var(--gg-space-2);
		border: 1px solid var(--gg-border);
		border-radius: 4px;
	}
	.group header {
		color: var(--gg-fg-muted);
		font-size: 0.8em;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.group ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.group li {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		font-size: 0.9em;
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}
	select {
		background: var(--vscode-dropdown-background, var(--vscode-input-background));
		color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
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
</style>
