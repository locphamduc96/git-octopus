import type { RebaseStep, RebaseTodoCommit } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/**
 * The editor while it is open: the base, and the commits to rewrite once the host has listed them.
 * `branch` is set when another branch is being rebased onto `base` rather than HEAD's own commits
 * rewritten in place.
 */
interface RebaseEditorState {
	base: string;
	/** How the dialog names `base`: a short hash in place, the branch name when moving onto one. */
	baseLabel: string;
	branch: string | null;
	listCommits: RebaseTodoCommit[] | null;
	error: string | null;
}

let state = $state<RebaseEditorState | null>(null);

onHostType('rebaseTodo', (message) => {
	if (!state || message.base !== state.base || (message.branch ?? null) !== state.branch) return;
	state = { ...state, listCommits: message.listCommits, error: message.error ?? null };
});

onRepoReset(() => {
	state = null;
});

export const rebaseEditor = {
	get current(): RebaseEditorState | null {
		return state;
	},
	open(base: string): void {
		state = { base, baseLabel: base.slice(0, 8), branch: null, listCommits: null, error: null };
		postToHost({ type: 'loadRebaseTodo', base });
	},
	/** Rebase `branch` onto `base`, editing its commits on the way. */
	openOnto(base: string, baseLabel: string, branch: string): void {
		state = { base, baseLabel, branch, listCommits: null, error: null };
		postToHost({ type: 'loadRebaseTodo', base, branch });
	},
	run(listSteps: RebaseStep[]): void {
		if (!state) return;
		postToHost({
			type: 'interactiveRebase',
			repoPath: session.repoPath,
			base: state.base,
			...(state.branch ? { branch: state.branch } : {}),
			listSteps,
		});
		state = null;
	},
	close(): void {
		state = null;
	},
};
