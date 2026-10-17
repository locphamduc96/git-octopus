<script lang="ts">
	import SelectField from '../../lib/ui/SelectField.svelte';
	import type { WritableSigningKey } from '@git-octopus/shared';
	import { LIST_WRITABLE_SIGNING_KEYS } from '@git-octopus/shared';
	import { signing } from '../../lib/stores/signing.svelte';
	import {
		effectiveFormat,
		gitBool,
		LIST_SIGNING_FORMATS,
		originLabel,
		signingProblems,
		type SigningFormat,
	} from '../../lib/signature';

	let {
		showSignatures,
		onshowSignatures,
	}: {
		showSignatures: boolean;
		onshowSignatures: (on: boolean) => void;
	} = $props();

	const current = $derived(signing.state);
	const mapValues = $derived(current?.mapValues ?? {});
	const format = $derived(current ? effectiveFormat(current) : null);
	const listProblems = $derived(current ? signingProblems(current) : []);
	const listLocalWritable = $derived(
		(current?.listLocalKeys ?? []).filter((key): key is WritableSigningKey =>
			(LIST_WRITABLE_SIGNING_KEYS as readonly string[]).includes(key)
		)
	);
	const disabled = $derived(!current?.repoPath || signing.busy);

	const savedKey = $derived(mapValues['user.signingkey']?.value ?? '');
	const savedSigners = $derived(mapValues['gpg.ssh.allowedsignersfile']?.value ?? '');
	// Reset whenever the host answers: what is shown is what git now has, not what was typed.
	let keyDraft = $state('');
	let signersDraft = $state('');
	$effect.pre(() => {
		keyDraft = savedKey;
	});
	$effect.pre(() => {
		signersDraft = savedSigners;
	});

	const mapKeyPlaceholder: Record<SigningFormat, string> = {
		openpgp: 'Key id, e.g. 3AA5C34371567BD2 — empty picks the key for your email',
		ssh: '~/.ssh/id_ed25519.pub, or key::ssh-ed25519 AAAA…',
		x509: 'Certificate id',
	};

	function save(key: WritableSigningKey, value: string | null): void {
		signing.save({ [key]: value });
	}

	function saveText(key: WritableSigningKey, draft: string): void {
		const value = draft.trim();
		save(key, value === '' ? null : value);
	}

	function useInherited(): void {
		signing.save(Object.fromEntries(listLocalWritable.map((key) => [key, null])));
	}
</script>

<section>
	<div class="row">
		<span class="row-label">
			Show signatures on the graph
			<span class="note">
				A shield by the subject of every signed commit, coloured by whether the signature checks
				out. Each signed commit is verified on every load, which slows large histories down.
			</span>
		</span>
		<input
			type="checkbox"
			aria-label="Show signatures on the graph"
			checked={showSignatures}
			onchange={(event) => onshowSignatures(event.currentTarget.checked)}
		/>
	</div>
</section>

<section class="config">
	<p class="note">
		Git signs each commit itself, through gpg-agent or ssh-agent — they ask for any passphrase.
		Changes here go to this repository's own config; the global one is never written.
	</p>

	{#if current === null}
		<p class="note">Reading the signing settings…</p>
	{:else}
		{#each listProblems as problem (problem)}
			<p class="note warn" role="alert">{problem}</p>
		{/each}

		<div class="row">
			<span class="row-label">
				Sign commits in this repository
				<span class="note">commit.gpgSign — {originLabel(mapValues['commit.gpgsign'])}</span>
			</span>
			<input
				type="checkbox"
				aria-label="Sign commits in this repository"
				checked={gitBool(mapValues['commit.gpgsign']) === true}
				{disabled}
				onchange={(event) => save('commit.gpgsign', String(event.currentTarget.checked))}
			/>
		</div>
		<div class="row">
			<span class="row-label">
				Sign tags
				<span class="note">tag.gpgSign — {originLabel(mapValues['tag.gpgsign'])}</span>
			</span>
			<input
				type="checkbox"
				aria-label="Sign tags"
				checked={gitBool(mapValues['tag.gpgsign']) === true}
				{disabled}
				onchange={(event) => save('tag.gpgsign', String(event.currentTarget.checked))}
			/>
		</div>
		<div class="row">
			<span class="row-label">
				Format
				<span class="note">gpg.format — {originLabel(mapValues['gpg.format'])}</span>
			</span>
			<SelectField
				aria-label="Signing format"
				value={format ?? ''}
				{disabled}
				onchange={(event) => save('gpg.format', event.currentTarget.value)}
			>
				{#if format === null}<option value="" disabled>(invalid)</option>{/if}
				{#each LIST_SIGNING_FORMATS as option (option)}
					<option value={option}>{option === 'openpgp' ? 'openpgp (gpg)' : option}</option>
				{/each}
			</SelectField>
		</div>
		<div class="row stacked">
			<span class="row-label">
				Signing key
				<span class="note">user.signingKey — {originLabel(mapValues['user.signingkey'])}</span>
			</span>
			<div class="field">
				<input
					aria-label="Signing key"
					placeholder={mapKeyPlaceholder[format ?? 'openpgp']}
					bind:value={keyDraft}
					{disabled}
					onkeydown={(event) => {
						if (event.key === 'Enter' && keyDraft.trim() !== savedKey)
							saveText('user.signingkey', keyDraft);
					}}
				/>
				<button
					class="mini"
					disabled={disabled || keyDraft.trim() === savedKey}
					onclick={() => saveText('user.signingkey', keyDraft)}>Save</button
				>
			</div>
		</div>
		{#if format === 'ssh'}
			<div class="row stacked">
				<span class="row-label">
					Allowed signers file
					<span class="note">
						gpg.ssh.allowedSignersFile — {originLabel(mapValues['gpg.ssh.allowedsignersfile'])}.
						Lines of “email key” — the keys git accepts as good SSH signatures.
					</span>
				</span>
				<div class="field">
					<input
						aria-label="Allowed signers file"
						placeholder="~/.ssh/allowed_signers"
						bind:value={signersDraft}
						{disabled}
						onkeydown={(event) => {
							if (event.key === 'Enter' && signersDraft.trim() !== savedSigners)
								saveText('gpg.ssh.allowedsignersfile', signersDraft);
						}}
					/>
					<button
						class="mini"
						disabled={disabled || signersDraft.trim() === savedSigners}
						onclick={() => saveText('gpg.ssh.allowedsignersfile', signersDraft)}>Save</button
					>
				</div>
			</div>
		{/if}
		{#if listLocalWritable.length > 0}
			<button class="linkish" disabled={signing.busy} onclick={useInherited}>
				Remove this repository's signing settings (use the inherited ones)
			</button>
		{/if}
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
	}
	section.config {
		gap: var(--gg-space-1);
		margin-top: var(--gg-space-2);
		padding-top: var(--gg-space-2);
		border-top: 1px solid color-mix(in srgb, var(--gg-fg) 8%, transparent);
	}
	/* The same 220px control column as the rest of Settings. */
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		align-items: center;
		gap: var(--gg-space-4);
		padding: var(--gg-space-3) 0;
		border-bottom: 1px solid color-mix(in srgb, var(--gg-fg) 8%, transparent);
	}
	.row > input[type='checkbox'] {
		justify-self: start;
	}
	.row.stacked {
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-1);
	}
	.row-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.note {
		margin: 0;
		font-size: var(--gg-text-xs);
		color: var(--gg-fg-muted);
	}
	.warn {
		color: var(--gg-warning);
	}
	.field {
		display: flex;
		gap: var(--gg-space-2);
		width: 100%;
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 2px var(--gg-space-2);
		font: inherit;
		color: var(--gg-input-fg);
		background: var(--gg-input-bg);
		border: 1px solid var(--gg-input-border);
		border-radius: var(--gg-radius);
	}
	.mini {
		flex: none;
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius);
		font: inherit;
		font-size: var(--gg-text-xs);
		padding: 1px var(--gg-space-2);
		cursor: pointer;
	}
	.mini:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.linkish {
		align-self: flex-start;
		margin-top: var(--gg-space-2);
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--gg-text-xs);
		color: var(--gg-accent);
		cursor: pointer;
	}
	.linkish:hover:not(:disabled) {
		text-decoration: underline;
	}
</style>
