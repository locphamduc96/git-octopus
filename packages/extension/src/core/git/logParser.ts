import type { Commit } from '@git-octopus/shared';

/** NUL-separated fields, one commit per line. Keep in sync with LOG_FORMAT. */
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s';

/**
 * Parse `git log` output produced with {@link LOG_FORMAT} into commits.
 * Pure — no I/O — so it can be unit-tested against captured fixtures.
 */
export function parseLog(output: string): Commit[] {
	const listCommits: Commit[] = [];
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [hash, parents, name, email, at, subject] = line.split('\0');
		if (!hash) continue;
		listCommits.push({
			hash,
			parents: parents ? parents.split(' ') : [],
			author: { name: name ?? '', email: email ?? '' },
			committedAt: Number.parseInt(at ?? '0', 10) || 0,
			subject: subject ?? '',
			refs: [],
		});
	}
	return listCommits;
}
