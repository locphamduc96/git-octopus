import type { Commit, GraphRow } from '@git-octopus/shared';

export interface FindOptions {
	matchCase: boolean;
	regex: boolean;
}

/** A query turned into a test, or the reason it could not be — a half-typed regex is not an error. */
export type FindMatcher = { test: (commit: Commit) => boolean } | { error: string };

/**
 * What a commit is found by: its subject, its author, the names of the refs on it, and its hash.
 *
 * The hash is matched as a prefix and ignores case and regex alike — nobody types a regex for a
 * hash, and `A1B2` pasted from a ticket must still find `a1b2…`. The Uncommitted row is never a
 * match: it has no subject or author of its own, only a count.
 */
export function buildMatcher(query: string, options: FindOptions): FindMatcher | null {
	const trimmed = query.trim();
	if (trimmed === '') return null;
	let matchText: (text: string) => boolean;
	if (options.regex) {
		let pattern: RegExp;
		try {
			pattern = new RegExp(trimmed, options.matchCase ? '' : 'i');
		} catch {
			return { error: 'Invalid regex' };
		}
		matchText = (text) => pattern.test(text);
	} else {
		const needle = options.matchCase ? trimmed : trimmed.toLowerCase();
		matchText = (text) => (options.matchCase ? text : text.toLowerCase()).includes(needle);
	}
	const hashPrefix = /^[0-9a-f]{4,40}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
	return {
		test: (commit) => {
			if (commit.isUncommitted) return false;
			if (hashPrefix !== null && commit.hash.startsWith(hashPrefix)) return true;
			if (matchText(commit.subject)) return true;
			if (matchText(commit.author.name) || matchText(commit.author.email)) return true;
			return commit.refs.some((ref) => ref.kind !== 'head' && matchText(refLabel(ref)));
		},
	};
}

function refLabel(ref: Exclude<Commit['refs'][number], { kind: 'head' }>): string {
	return ref.kind === 'branch' && ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
}

/** Hashes of the matching rows, in graph order. */
export function listMatchHashes(rows: GraphRow[], matcher: FindMatcher | null): string[] {
	if (matcher === null || 'error' in matcher) return [];
	return rows.filter((row) => matcher.test(row.commit)).map((row) => row.commit.hash);
}

/**
 * The match `step` places away from `current`, wrapping at both ends.
 *
 * With no current match — the query just changed — forward lands on the first match at or below
 * `anchor` (the selected commit), so a search starts where the user is looking, not at the top.
 */
export function stepMatch(
	listMatches: string[],
	current: string | null,
	step: 1 | -1,
	listOrder: string[] = listMatches,
	anchor: string | null = null
): string | null {
	if (listMatches.length === 0) return null;
	const index = current === null ? -1 : listMatches.indexOf(current);
	if (index !== -1) {
		return listMatches[(index + step + listMatches.length) % listMatches.length];
	}
	const anchorAt = anchor === null ? -1 : listOrder.indexOf(anchor);
	if (anchorAt !== -1) {
		const setMatches = new Set(listMatches);
		if (step === 1) {
			for (let i = anchorAt; i < listOrder.length; i++)
				if (setMatches.has(listOrder[i])) return listOrder[i];
		} else {
			for (let i = anchorAt; i >= 0; i--) if (setMatches.has(listOrder[i])) return listOrder[i];
		}
	}
	return step === 1 ? listMatches[0] : listMatches[listMatches.length - 1];
}
