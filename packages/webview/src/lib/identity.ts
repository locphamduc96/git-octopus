import type { GitIdentity } from '@git-octopus/shared';

/** The saved identity whose email the repository is currently committing with, if any. */
export function matchIdentity(
	listIdentities: GitIdentity[],
	email: string | null
): GitIdentity | null {
	if (!email) return null;
	return listIdentities.find((identity) => identity.email === email) ?? null;
}

/**
 * The host part of a remote URL, offered as the starting point for a new identity's pattern. Git
 * remotes come in two shapes — `https://host/path` and the scp-like `git@host:path` — and only the
 * first parses as a URL.
 */
export function remoteHost(url: string): string | null {
	const scp = /^[^\s/]+@([^\s:/]+):/.exec(url.trim());
	if (scp) return scp[1];
	try {
		return new URL(url.trim()).host || null;
	} catch {
		return null;
	}
}

/**
 * One identity's patterns, ready to match: `hostPattern` holds one or more substrings separated
 * by commas, so an identity can cover a client's GitHub org and their self-hosted GitLab at once.
 */
function listPatterns(identity: GitIdentity): string[] {
	return (identity.hostPattern ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

/**
 * Every identity whose pattern appears in any remote URL, in saved order. Identities without a
 * pattern are never matched. More than one answer means the remotes are ambiguous — callers that
 * act (rather than suggest) must treat that as "don't".
 */
export function listMatchedIdentities(
	listIdentities: GitIdentity[],
	listRemoteUrls: string[]
): GitIdentity[] {
	return listIdentities.filter((identity) => {
		const patterns = listPatterns(identity);
		return (
			patterns.length > 0 &&
			listRemoteUrls.some((url) => patterns.some((pattern) => url.includes(pattern)))
		);
	});
}

/** The identity a repository's remotes point at: the first match, for the suggestion UI. */
export function suggestIdentity(
	listIdentities: GitIdentity[],
	listRemoteUrls: string[]
): GitIdentity | null {
	return listMatchedIdentities(listIdentities, listRemoteUrls)[0] ?? null;
}

/**
 * The suggested identity when it differs from the one in use — the "you are about to commit to a
 * company repo with your personal email" warning. Null when everything lines up.
 */
export function identityMismatch(
	listIdentities: GitIdentity[],
	listRemoteUrls: string[],
	email: string | null
): GitIdentity | null {
	const suggested = suggestIdentity(listIdentities, listRemoteUrls);
	if (!suggested) return null;
	return suggested.email === email ? null : suggested;
}
