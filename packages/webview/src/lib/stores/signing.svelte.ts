import type { SigningMessage, WritableSigningKey } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/** The repository's signing config as the Signing tab shows it; null until the host has answered. */
let state = $state<SigningMessage | null>(null);
/** A write is on its way; the tab redraws from the host's answer, never from what it sent. */
let busy = $state(false);

onHostType('signing', (message) => {
	state = message;
	busy = false;
});

onRepoReset(() => {
	state = null;
	busy = false;
});

export const signing = {
	get state(): SigningMessage | null {
		return state;
	},
	get busy(): boolean {
		return busy;
	},
	load(): void {
		postToHost({ type: 'loadSigning' });
	},
	save(mapValues: Partial<Record<WritableSigningKey, string | null>>): void {
		busy = true;
		postToHost({ type: 'signingAction', repoPath: session.repoPath, mapValues });
	},
};
