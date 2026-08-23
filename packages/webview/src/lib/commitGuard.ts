import type { GitIdentity, WorkingTreeAction } from '@git-octopus/shared';

export type CommitGuardPlan = { kind: 'proceed' } | { kind: 'ask'; suggested: GitIdentity };

/**
 * Only a plain commit is worth interrupting: it is the moment a wrong email becomes history that
 * needs a rewrite to fix. Amend is left alone on purpose — rewriting an existing commit is a
 * deliberate act in a different frame of mind, and a second question there reads as nagging.
 */
export function planCommitGuard(
	action: WorkingTreeAction,
	suggested: GitIdentity | null
): CommitGuardPlan {
	if (action === 'commit' && suggested !== null) return { kind: 'ask', suggested };
	return { kind: 'proceed' };
}
