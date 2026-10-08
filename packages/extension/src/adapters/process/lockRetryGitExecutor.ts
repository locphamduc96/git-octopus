import { busyLockPath, retriesOnLock } from '../../core/git/indexLock.js';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';
import { readLockState, type LockState } from './lockState.js';

/** The waits between attempts — about 2.75 s in all, after which the failure is the user's to see. */
export const LIST_LOCK_BACKOFF_MS = [50, 100, 200, 400, 800, 1200];

export interface LockRetryDeps {
	sleep: (ms: number) => Promise<void>;
	readLock: (lockPath: string) => Promise<LockState>;
}

const DEFAULT_DEPS: LockRetryDeps = {
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	readLock: (lockPath) => readLockState(lockPath, Date.now()),
};

/**
 * Runs a write again when another process was holding `.git/index.lock` for a moment.
 *
 * Another client, another window or a terminal can hold the lock for the few milliseconds of its
 * own write at exactly the moment the user presses a button here, and git does not wait for it:
 * the loser dies with `Unable to create … index.lock: File exists`. So the waiting happens here.
 * Only for writes that die before changing anything ({@link retriesOnLock}), which makes the next
 * attempt the same request rather than a second one.
 *
 * A lock that is already junk — empty and untouched for ten seconds — will not go away by waiting,
 * so that failure goes straight through to the notice that offers to remove it.
 */
export class LockRetryGitExecutor implements GitExecutor {
	public constructor(
		private readonly inner: GitExecutor,
		private readonly deps: LockRetryDeps = DEFAULT_DEPS
	) {}

	public async run(
		args: string[],
		cwd: string,
		listOkCodes?: number[],
		auth?: GitAuthRequest
	): Promise<string> {
		if (!retriesOnLock(args)) return this.inner.run(args, cwd, listOkCodes, auth);
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.inner.run(args, cwd, listOkCodes, auth);
			} catch (error) {
				const lockPath = busyLockPath(error instanceof Error ? error.message : String(error));
				if (lockPath === null || attempt >= LIST_LOCK_BACKOFF_MS.length) throw error;
				const state = await this.deps.readLock(lockPath);
				if (state.kind === 'stale') throw error;
				// Already released by the time we looked: go again at once instead of waiting.
				if (state.kind === 'live') await this.deps.sleep(LIST_LOCK_BACKOFF_MS[attempt]);
			}
		}
	}
}
