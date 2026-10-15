import type { WorktreeInfo } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';

/** The repository's worktrees; null until the host has answered. */
let listWorktrees = $state<WorktreeInfo[] | null>(null);
/** An action is on its way; the list is replaced when the host answers it. */
let busy = $state(false);

onHostType('worktrees', (message) => {
	listWorktrees = message.listWorktrees;
	busy = false;
});

onRepoReset(() => {
	listWorktrees = null;
	busy = false;
});

function act(
	action: 'open' | 'add' | 'remove' | 'prune',
	extra: { path?: string; branch?: string }
): void {
	if (action !== 'open') busy = true;
	postToHost({ type: 'worktreeAction', repoPath: session.repoPath, action, ...extra });
}

export const worktrees = {
	get list(): WorktreeInfo[] | null {
		return listWorktrees;
	},
	get busy(): boolean {
		return busy;
	},
	/**
	 * Branch → folder for the branches checked out in a worktree other than this window's, which
	 * the branch menus offer to open instead of checking out.
	 */
	get mapElsewhere(): Record<string, string> {
		const mapByBranch: Record<string, string> = {};
		for (const worktree of listWorktrees ?? []) {
			if (worktree.branch && !worktree.isCurrent && !worktree.prunable) {
				mapByBranch[worktree.branch] = worktree.path;
			}
		}
		return mapByBranch;
	},
	load(): void {
		postToHost({ type: 'loadWorktrees' });
	},
	open(path: string): void {
		act('open', { path });
	},
	/** `path` empty: the host asks where, suggesting a folder beside the repository. */
	add(branch: string, path = ''): void {
		act('add', path === '' ? { branch } : { branch, path });
	},
	remove(path: string): void {
		act('remove', { path });
	},
	prune(): void {
		act('prune', {});
	},
};
