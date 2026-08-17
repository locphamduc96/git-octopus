/**
 * Map the common authentication failures onto messages that say what to do next. Anything not
 * recognised returns null and the (already redacted) original is shown instead.
 *
 * Deliberately absent: any advice to delete known_hosts entries. A changed host key can be a
 * machine reinstall — or an interception — and only someone who can verify the fingerprint out
 * of band can tell which.
 */
export function friendlyGitError(message: string): string | null {
	if (message.includes('could not read Username')) {
		return (
			'No stored credentials for this remote. Run the action again to sign in when prompted, ' +
			'or configure a git credential helper to remember them.'
		);
	}
	if (/authentication failed/i.test(message)) {
		return (
			'Authentication failed — the credentials were refused. For GitHub and most hosts this ' +
			'needs a personal access token, not an account password.'
		);
	}
	if (message.includes('Permission denied (publickey)')) {
		return (
			'SSH rejected the key. Check that ssh-agent is running and holds the right key for ' +
			'this remote (ssh-add -l).'
		);
	}
	if (message.includes('Host key verification failed')) {
		return (
			"The remote's SSH host key does not match what this machine has seen before. Verify " +
			'the fingerprint with whoever runs the server before connecting again.'
		);
	}
	return null;
}
