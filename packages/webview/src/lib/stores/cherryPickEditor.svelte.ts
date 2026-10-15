import type { Commit } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/** The commits the editor opened with, in the order they would apply, and where they land. */
interface CherryPickEditorState {
	listCommits: Commit[];
	/** The checked-out branch, or null on a detached HEAD. */
	target: string | null;
}

let state = $state<CherryPickEditorState | null>(null);

onRepoReset(() => {
	state = null;
});

export const cherryPickEditor = {
	get current(): CherryPickEditorState | null {
		return state;
	},
	/** `listNewestFirst` is the selection in row order; the editor lists it oldest first. */
	open(listNewestFirst: Commit[], target: string | null): void {
		state = { listCommits: [...listNewestFirst].reverse(), target };
	},
	run(listHashes: string[], options: { recordOrigin: boolean; noCommit: boolean }): void {
		if (!state || listHashes.length === 0) return;
		postToHost({
			type: 'cherryPickCommits',
			repoPath: session.repoPath,
			listHashes,
			...options,
		});
		state = null;
	},
	close(): void {
		state = null;
	},
};
