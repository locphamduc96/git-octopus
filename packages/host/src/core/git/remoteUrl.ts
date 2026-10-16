/**
 * The web URL of a commit on its hosting service, or null when the remote is not recognised.
 * Handles https and ssh (scp-like) remotes for GitHub, GitLab and Bitbucket.
 */
export function remoteCommitUrl(remoteUrl: string, hash: string): string | null {
	const base = webBaseUrl(remoteUrl);
	if (!base) return null;
	const host = new URL(base).hostname;
	if (host.includes('bitbucket')) return `${base}/commits/${hash}`;
	if (host.includes('gitlab')) return `${base}/-/commit/${hash}`;
	if (host.includes('github')) return `${base}/commit/${hash}`;
	return null;
}

/** Normalise a git remote URL to the repository's web URL, or null when it cannot be one. */
function webBaseUrl(remoteUrl: string): string | null {
	const trimmed = remoteUrl
		.trim()
		.replace(/\.git$/, '')
		.replace(/\/$/, '');

	if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
		try {
			const url = new URL(trimmed);
			// Strip credentials some remotes embed (https://user:token@host/…).
			return `https://${url.hostname}${url.pathname}`;
		} catch {
			return null;
		}
	}

	// scp-like ssh: [user@]host:path — "git@github.com:owner/repo".
	const scp = /^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/.exec(trimmed);
	if (scp && !trimmed.includes('://')) {
		return `https://${scp[1]}/${scp[2]}`;
	}
	if (trimmed.startsWith('ssh://')) {
		const rest = trimmed.slice('ssh://'.length);
		const [hostPart, ...pathParts] = rest.split('/');
		const host = hostPart.split('@').pop()?.split(':')[0];
		if (!host || pathParts.length === 0) return null;
		return `https://${host}/${pathParts.join('/')}`;
	}
	return null;
}
