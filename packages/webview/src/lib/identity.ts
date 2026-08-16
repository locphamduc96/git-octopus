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
 * The identity a repository's remotes point at: the first one whose `hostPattern` appears in any
 * remote URL. Identities without a pattern are never suggested.
 */
export function suggestIdentity(
	listIdentities: GitIdentity[],
	listRemoteUrls: string[]
): GitIdentity | null {
	for (const identity of listIdentities) {
		const pattern = identity.hostPattern?.trim();
		if (!pattern) continue;
		if (listRemoteUrls.some((url) => url.includes(pattern))) return identity;
	}
	return null;
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
