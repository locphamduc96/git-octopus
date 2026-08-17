/**
 * The hosts a repository's remotes point at, from `git remote -v` output. This is what an auth
 * prompt is allowed to claim it is asking for — resolved from the repository before the command
 * is spawned, never from the prompt text, which an adversary controls.
 */
export function parseRemoteHosts(remoteVerboseOutput: string): string[] {
	const setHosts = new Set<string>();
	for (const line of remoteVerboseOutput.split('\n')) {
		const url = line.split('\t')[1]?.split(' ')[0]?.trim();
		if (!url) continue;
		const host = hostOfRemoteUrl(url);
		if (host) setHosts.add(host);
	}
	return [...setHosts];
}

/** The host part of any of git's remote URL shapes, lowercased, or null when unparseable. */
export function hostOfRemoteUrl(url: string): string | null {
	// Scheme URLs: https://host/…, ssh://user@host:port/…, git://host/….
	const scheme = /^[a-z+]+:\/\/(?:[^/@]+@)?([^/:]+)/i.exec(url);
	if (scheme) return scheme[1].toLowerCase();
	// scp-like: user@host:path — the colon separates host from path, not a port.
	const scp = /^(?:[^@/]+@)([^:/]+):/.exec(url);
	if (scp) return scp[1].toLowerCase();
	return null;
}
