/**
 * A recognised failure, and the one thing the user could do about it.
 *
 * `action` is declarative data, never a callback: this lives in `core`, which does not import
 * `vscode`, so deciding what a button does — and whether it is safe to offer at all — belongs to
 * the adapter that shows it.
 */
export interface GitErrorDetail {
	message: string;
	action?: { id: 'removeStaleLock'; lockPath: string };
}

/**
 * Pull the lock path out of git's own wording.
 *
 * Two shapes, because the commands do not agree. Most writes say
 * `fatal: Unable to create '<path>': File exists.` and name the file; `git stash push` says only
 * `error: could not write index` and names nothing, so its path has to be rebuilt from the
 * repository. Matching just the first shape would silently miss stash.
 */
function staleLockPath(message: string, cwd: string | undefined): string | null {
	const named = /Unable to create '(.+?\.lock)': File exists/.exec(message);
	if (named) return named[1];
	if (/could not write index/.test(message) && cwd !== undefined) {
		return `${cwd}/.git/index.lock`;
	}
	return null;
}

/**
 * The full reading of a git failure: the sentence to show, plus a remedy when there is one.
 *
 * {@link friendlyGitError} is the older, message-only view of this, kept because most call sites
 * have nowhere to put a button.
 */
export function friendlyGitErrorDetail(message: string, cwd?: string): GitErrorDetail | null {
	const lockPath = staleLockPath(message, cwd);
	if (lockPath !== null) {
		return {
			// Git blames a running process, which is the one thing this is usually not: the file
			// outlives whatever made it, and nothing ever expires it.
			message:
				'Another git command is holding this repository, or a stale lock file was left behind ' +
				'by one that was interrupted. Nothing can change the index until it is gone.',
			action: { id: 'removeStaleLock', lockPath },
		};
	}
	const plain = friendlyGitError(message);
	return plain === null ? null : { message: plain };
}

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
	// Two different phrasings for the same repository: one from the history walkers, one from the
	// commands that need something to build on.
	if (
		/does not have any commits yet/.test(message) ||
		message.includes('You do not have the initial commit yet')
	) {
		return 'This repository has no commits yet. Make the first commit before running this.';
	}
	if (message.includes('Host key verification failed')) {
		return (
			"The remote's SSH host key does not match what this machine has seen before. Verify " +
			'the fingerprint with whoever runs the server before connecting again.'
		);
	}
	return null;
}
