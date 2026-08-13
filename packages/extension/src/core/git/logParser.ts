import type { Commit, Ref } from '@git-octopus/shared';

/** NUL-separated fields, one commit per line. Keep in sync with LOG_FORMAT. */
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D';

/**
 * Parse `git log` output produced with {@link LOG_FORMAT} into commits.
 * Pure — no I/O — so it can be unit-tested against captured fixtures.
 */
export function parseLog(output: string): Commit[] {
	const listCommits: Commit[] = [];
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [hash, parents, name, email, at, subject, decoration] = line.split('\0');
		if (!hash) continue;
		listCommits.push({
			hash,
			parents: parents ? parents.split(' ') : [],
			author: { name: name ?? '', email: email ?? '' },
			committedAt: Number.parseInt(at ?? '0', 10) || 0,
			subject: subject ?? '',
			refs: parseRefs(decoration ?? ''),
		});
	}
	return listCommits;
}

/** Parse a `%D` decoration string (e.g. "HEAD -> main, tag: v1, origin/main") into refs. */
export function parseRefs(decoration: string): Ref[] {
	const listRefs: Ref[] = [];
	for (const raw of decoration.split(',')) {
		const token = raw.trim();
		if (token === '') continue;
		// Refs outside heads/remotes/tags are printed in full ("refs/stash", "refs/notes/commits").
		// They are git's own bookkeeping, not branches, so they never become chips.
		if (token.startsWith('refs/')) continue;
		if (token.startsWith('tag: ')) {
			listRefs.push({ kind: 'tag', name: token.slice(5) });
		} else if (token.startsWith('HEAD -> ')) {
			listRefs.push({ kind: 'head' });
			pushBranch(listRefs, token.slice('HEAD -> '.length));
		} else if (token === 'HEAD') {
			listRefs.push({ kind: 'head' });
		} else {
			pushBranch(listRefs, token);
		}
	}
	return listRefs;
}

function pushBranch(listRefs: Ref[], name: string): void {
	const slash = name.indexOf('/');
	if (slash === -1) {
		listRefs.push({ kind: 'branch', name });
		return;
	}
	const branch = name.slice(slash + 1);
	// `<remote>/HEAD` is a symbolic ref for the remote's default branch, so it always duplicates
	// another label on the same commit — showing it adds noise and reads like the local HEAD.
	if (branch === 'HEAD') return;
	listRefs.push({ kind: 'branch', name: branch, remote: name.slice(0, slash) });
}
