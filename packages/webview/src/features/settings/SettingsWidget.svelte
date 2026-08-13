<script lang="ts">
	export type DateFormat = 'dateTime' | 'dateOnly' | 'iso' | 'relative';
	export type GraphStyle = 'rounded' | 'angular';

	export interface ViewSettings {
		commitLimit: number;
		dateFormat: DateFormat;
		graphStyle: GraphStyle;
		fetchAvatars: boolean;
	}

	let {
		settings,
		onchange,
		onclose,
	}: {
		settings: ViewSettings;
		onchange: (settings: ViewSettings) => void;
		onclose: () => void;
	} = $props();

	const listLimits = [100, 300, 500, 1000];
	const listDateFormats: { value: DateFormat; label: string }[] = [
		{ value: 'dateTime', label: 'Date & Time' },
		{ value: 'dateOnly', label: 'Date Only' },
		{ value: 'iso', label: 'ISO Date & Time' },
		{ value: 'relative', label: 'Relative' },
	];
</script>

<button class="backdrop" onclick={onclose} aria-label="Close settings"></button>
<div class="panel">
	<header>
		<span>Settings</span>
		<button onclick={onclose} aria-label="Close">✕</button>
	</header>

	<label>
		Commits to load
		<select
			value={String(settings.commitLimit)}
			onchange={(event) =>
				onchange({ ...settings, commitLimit: Number(event.currentTarget.value) })}
		>
			{#each listLimits as limit (limit)}
				<option value={String(limit)}>{limit}</option>
			{/each}
		</select>
	</label>

	<label>
		Date format
		<select
			value={settings.dateFormat}
			onchange={(event) =>
				onchange({ ...settings, dateFormat: event.currentTarget.value as DateFormat })}
		>
			{#each listDateFormats as format (format.value)}
				<option value={format.value}>{format.label}</option>
			{/each}
		</select>
	</label>

	<label>
		Graph style
		<select
			value={settings.graphStyle}
			onchange={(event) =>
				onchange({ ...settings, graphStyle: event.currentTarget.value as GraphStyle })}
		>
			<option value="rounded">Rounded</option>
			<option value="angular">Angular</option>
		</select>
	</label>

	<label class="check">
		<input
			type="checkbox"
			checked={settings.fetchAvatars}
			onchange={(event) =>
				onchange({ ...settings, fetchAvatars: event.currentTarget.checked })}
		/>
		Show author avatars
	</label>
	<p class="note">Avatars are loaded from Gravatar using a hash of the author's email address.</p>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		padding: 0;
		z-index: 30;
		cursor: default;
	}
	.panel {
		position: fixed;
		z-index: 31;
		top: 60px;
		right: var(--gg-space-3);
		width: 260px;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		padding: var(--gg-space-3);
		background: var(--vscode-editorWidget-background, var(--gg-bg));
		border: 1px solid var(--gg-border);
		border-radius: 4px;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
	}
	header {
		display: flex;
		align-items: center;
		font-weight: 600;
	}
	header button {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--gg-fg-muted);
		cursor: pointer;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
		font-size: 0.9em;
		color: var(--gg-fg-muted);
	}
	.check {
		flex-direction: row;
		align-items: center;
		color: var(--gg-fg);
		cursor: pointer;
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
	}
</style>
