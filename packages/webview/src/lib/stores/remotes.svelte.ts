import type { RemoteInfo } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/** The repository's remotes as the Remotes tab shows them; null until the host has answered. */
let listRemotes = $state<RemoteInfo[] | null>(null);
/** An add or remove is on its way; the list is replaced when the host answers it. */
let busy = $state(false);

onHostType('remotes', (message) => {
	listRemotes = message.listRemotes;
	busy = false;
});

onRepoReset(() => {
	listRemotes = null;
	busy = false;
});

export const remotes = {
	get list(): RemoteInfo[] | null {
		return listRemotes;
	},
	get busy(): boolean {
		return busy;
	},
	load(): void {
		postToHost({ type: 'loadRemotes' });
	},
	add(name: string, url: string): void {
		busy = true;
		postToHost({ type: 'remoteAction', repoPath: session.repoPath, action: 'add', name, url });
	},
	remove(name: string): void {
		busy = true;
		postToHost({ type: 'remoteAction', repoPath: session.repoPath, action: 'remove', name });
	},
};
