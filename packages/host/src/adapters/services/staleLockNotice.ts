import * as fs from 'node:fs/promises';
import { friendlyGitErrorDetail } from '../../core/git/friendlyGitError.js';
import { readLockState as readLock } from '../process/lockState.js';
import type { Notifier } from '../../app/ports/shell.js';

/**
 * Report a failed git command, and offer to clear the lock when the lock is provably junk.
 *
 * Git's own wording for this failure blames "another git process ... running in this repository",
 * which sends people hunting for a process that exited days ago. The file has no timeout and
 * nothing ever cleans it up, so a one-second interruption presents as a repository that has been
 * broken all week.
 *
 * By the time a lock failure gets here, `LockRetryGitExecutor` has already waited out a lock that
 * was only briefly held. Nothing is retried after the dialog: the user asked for one thing to
 * happen, and silently doing it later, after a dialog about something else, is not that.
 */
export interface GitErrorFraming {
	/** What was being attempted, e.g. `could not undo Merge feature/x` — read before the reason. */
	lead?: string;
	/** What the caller knows and the message does not, e.g. how far a multi-step action got. */
	note?: string;
}

export async function showGitError(
	notify: Notifier,
	raw: string,
	cwd: string | undefined,
	framing: GitErrorFraming = {}
): Promise<void> {
	const detail = friendlyGitErrorDetail(raw, cwd);
	const message =
		`Git Octopus: ${framing.lead === undefined ? '' : `${framing.lead} — `}` +
		`${detail?.message ?? raw}${framing.note === undefined ? '' : ` ${framing.note}`}`;
	if (detail?.action === undefined) {
		void notify.error(message);
		return;
	}

	const { lockPath } = detail.action;
	const state = await readLock(lockPath, Date.now());
	if (state.kind !== 'stale') {
		// Something is genuinely holding it. Say so without offering a button that would break it.
		void notify.error(message);
		return;
	}

	const REMOVE = 'Remove stale lock';
	const choice = await notify.error(
		`${message} The lock file is empty and has not been touched for a while, so whatever made it is gone.`,
		REMOVE
	);
	if (choice !== REMOVE) return;

	// Checked again, because the dialog was on screen for an unbounded amount of time and a real
	// command may have started in the meantime.
	const recheck = await readLock(lockPath, Date.now());
	if (recheck.kind === 'live') {
		void notify.warn('Git Octopus: a git command is using that lock now — nothing was removed.');
		return;
	}
	try {
		await fs.rm(lockPath, { force: true });
		void notify.info('Git Octopus: stale lock removed. Run the action again.');
	} catch (error) {
		void notify.error(
			`Git Octopus: could not remove ${lockPath} — ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
