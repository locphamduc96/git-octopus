import * as fs from 'node:fs/promises';

/**
 * A lock younger than this may still belong to a command that is running right now: git creates
 * `index.lock` empty and only writes into it at the end, so "empty" alone does not mean abandoned.
 * Ten seconds is far longer than any index write on a repository this extension can open, and far
 * shorter than the days an orphan actually survives — nothing ever expires one.
 */
export const STALE_AFTER_MS = 10_000;

/** What the lock file on disk says about itself. */
export type LockState =
	| { kind: 'stale'; size: 0 }
	/** Present, but either still being written or holding real content — not ours to delete. */
	| { kind: 'live' }
	| { kind: 'gone' };

export async function readLockState(lockPath: string, now: number): Promise<LockState> {
	try {
		const stat = await fs.stat(lockPath);
		// Content means some command got far enough to write into it; deleting that can corrupt the
		// index it was about to become. Only the empty ones are safe to judge by age.
		if (stat.size !== 0) return { kind: 'live' };
		return now - stat.mtimeMs >= STALE_AFTER_MS ? { kind: 'stale', size: 0 } : { kind: 'live' };
	} catch {
		return { kind: 'gone' };
	}
}
