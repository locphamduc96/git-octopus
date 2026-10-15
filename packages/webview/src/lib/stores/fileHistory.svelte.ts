import type { FileHistoryEntry } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';

/**
 * The file whose history the panel is showing, and what the host answered for it.
 *
 * Null while the panel shows something else. The answer is matched on path and revision, so a reply
 * for a file the user already moved on from is dropped instead of replacing the list on screen.
 */
interface FileHistoryState {
	path: string;
	rev: string | null;
	listEntries: FileHistoryEntry[];
	loading: boolean;
	truncated: boolean;
	error: string | null;
	/** The entry whose diff is open, so the list can mark it. */
	activeHash: string | null;
}

let state = $state<FileHistoryState | null>(null);

onHostType('fileHistory', (message) => {
	if (!state || message.path !== state.path || message.rev !== state.rev) return;
	state = {
		...state,
		listEntries: message.listEntries,
		truncated: message.truncated,
		error: message.error ?? null,
		loading: false,
	};
});

onRepoReset(() => {
	state = null;
});

export const fileHistory = {
	get current(): FileHistoryState | null {
		return state;
	},
	/** Read the history of `path`, walking from `rev` (a commit) or from HEAD. */
	open(path: string, rev: string | null): void {
		state = {
			path,
			rev,
			listEntries: [],
			loading: true,
			truncated: false,
			error: null,
			activeHash: null,
		};
		postToHost({ type: 'loadFileHistory', path, ...(rev ? { rev } : {}) });
	},
	setActive(hash: string | null): void {
		if (state) state = { ...state, activeHash: hash };
	},
	close(): void {
		state = null;
	},
};
