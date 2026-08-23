import type { GitIdentity, WorkspaceIdentityEntry } from '@git-octopus/shared';

/**
 * The "This workspace" table, or nothing. One repository has nothing to compare against — the
 * "Committing as…" line at the top of the tab already says it — so the table only appears from two
 * repositories up, sorted by name so it reads the same way the repository picker does.
 */
export function buildWorkspaceRows(listRepos: WorkspaceIdentityEntry[]): WorkspaceIdentityEntry[] {
	if (listRepos.length < 2) return [];
	return [...listRepos].sort((a, b) => a.repoName.localeCompare(b.repoName));
}

/** A row is worth a "Save…" when it commits with an email no saved card carries yet. */
export function canSaveEntry(
	entry: WorkspaceIdentityEntry,
	listIdentities: GitIdentity[]
): boolean {
	const email = entry.email;
	return email !== null && !listIdentities.some((item) => item.email === email);
}
