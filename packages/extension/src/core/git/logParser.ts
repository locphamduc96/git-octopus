import type { Commit, Ref } from '@git-octopus/shared';

/** NUL-separated fields, one commit per line. Keep in sync with LOG_FORMAT. */
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D';

/**
 * Parse `git log` output produced with {@link LOG_FORMAT} into commits.
 * Pure — no I/O — so it can be unit-tested against captured fixtures.
 */
export function parseLog(output: string): Commit[] {
	const listCommits: Commit[] = [];
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [hash, parents, name, email, authoredAt, committedAt, subject, decoration] =
			line.split('\0');
		if (!hash) continue;
		listCommits.push({
			hash,
			parents: parents ? parents.split(' ') : [],
			author: { name: name ?? '', email: email ?? '' },
			authoredAt: Number.parseInt(authoredAt ?? '0', 10) || 0,
			committedAt: Number.parseInt(committedAt ?? '0', 10) || 0,
			subject: subject ?? '',
			refs: parseRefs(decoration ?? ''),
		});
	}
	return listCommits;
}

/**
 * Parse a `%D` decoration produced with `--decorate=full`, e.g.
 * `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main`.
 *
 * Full paths are essential: the short form prints a local `feature/x` and a remote `origin/x`
 * the same way, so a local branch whose name contains a slash would be misread as a remote one.
 */
export function parseRefs(decoration: string): Ref[] {
	const listRefs: Ref[] = [];
	for (const raw of decoration.split(',')) {
		const token = raw.trim();
		if (token === '') continue;

		if (token.startsWith('tag: ')) {
			listRefs.push({ kind: 'tag', name: stripPrefix(token.slice(5), 'refs/tags/') });
			continue;
		}
		if (token === 'HEAD') {
			listRefs.push({ kind: 'head' });
			continue;
		}
		if (token.startsWith('HEAD -> ')) {
			listRefs.push({ kind: 'head' });
			pushBranch(listRefs, token.slice('HEAD -> '.length));
			continue;
		}
		pushBranch(listRefs, token);
	}
	return listRefs;
}

function pushBranch(listRefs: Ref[], ref: string): void {
	if (ref.startsWith('refs/heads/')) {
		listRefs.push({ kind: 'branch', name: ref.slice('refs/heads/'.length) });
		return;
	}
	if (ref.startsWith('refs/remotes/')) {
		const rest = ref.slice('refs/remotes/'.length);
		const slash = rest.indexOf('/');
		if (slash === -1) return;
		const name = rest.slice(slash + 1);
		// `<remote>/HEAD` is a symbolic ref for the remote's default branch, so it always duplicates
		// another label on the same commit — showing it adds noise and reads like the local HEAD.
		if (name === 'HEAD') return;
		listRefs.push({ kind: 'branch', name, remote: rest.slice(0, slash) });
		return;
	}
	// Anything else under refs/ is git's own bookkeeping (stash, notes, bisect): not a branch.
}

function stripPrefix(value: string, prefix: string): string {
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
