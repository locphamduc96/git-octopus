<script lang="ts">
	import { onMount } from 'svelte';
	import type { HostToWebview } from '@git-octopus/shared';
	import { onHostMessage, postToHost } from './lib/bridge';

	let version = $state<string | null>(null);
	let handshake = $state<'pending' | 'ok'>('pending');

	onMount(() => {
		const off = onHostMessage((message: HostToWebview) => {
			if (message.type === 'pong') {
				version = message.version;
				handshake = 'ok';
			}
		});
		postToHost({ type: 'ready' });
		return off;
	});

	function ping(): void {
		postToHost({ type: 'ping', nonce: Date.now() });
	}
</script>

<main>
	<h1>🐙 Git Octopus</h1>
	<p class="status" class:ok={handshake === 'ok'}>
		host bridge: {handshake === 'ok' ? `connected (v${version})` : 'waiting…'}
	</p>
	<button onclick={ping}>Ping host</button>
	<p class="hint">Scaffold — the graph view lands in Feature 002.</p>
</main>

<style>
	main {
		padding: var(--gg-space-4);
	}
	h1 {
		font-size: 1.2rem;
		margin: 0 0 var(--gg-space-3);
	}
	.status {
		color: var(--gg-fg-muted);
	}
	.status.ok {
		color: var(--gg-accent);
	}
	.hint {
		color: var(--gg-fg-muted);
		font-size: 0.85em;
		margin-top: var(--gg-space-4);
	}
	button {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		padding: var(--gg-space-1) var(--gg-space-3);
		cursor: pointer;
	}
	button:hover {
		background: var(--vscode-button-hoverBackground);
	}
</style>
