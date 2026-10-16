import { writesIndex } from '../../core/git/indexLock.js';
import type { GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';

/**
 * Runs one index-writing git command at a time per repository.
 *
 * Two git processes that both need `.git/index.lock` do not take turns — the loser dies outright
 * with `fatal: Unable to create … index.lock: File exists`, and it is whichever one lost, so the
 * casualty is as likely to be the button the user just pressed as it is a background refresh.
 * Measured: 2,880 concurrent commands on one repository produced 1,294 such failures.
 *
 * Only the commands that take the lock mandatorily are queued (see {@link writesIndex}). Reads stay
 * parallel on purpose: a loaded graph is seven concurrent commands, none of which can fail this way
 * — `status` and `diff` want the lock only to write back a stat cache and simply skip it when it is
 * held.
 *
 * What this does NOT fix: a lock file left behind by a git process that was killed mid-write. The
 * loser of a race never creates the file (git opens it `O_CREAT|O_EXCL`), so serializing cannot
 * prevent an orphan — recovering from one is a separate job.
 *
 * Known limit: the unit of exclusion is one command, not one action. A multi-step action —
 * `reset` then `add` then `commit`, or `checkout` then `merge --ff-only` — still lets another
 * command interleave between its steps. Raising the unit to the action would mean holding the queue
 * across user prompts, which is a bigger change than the failure it prevents.
 */
export class SerializingGitExecutor implements GitExecutor {
	/** Tail of the promise chain per repository path; absent means nothing is queued there. */
	private readonly mapQueueTail = new Map<string, Promise<unknown>>();

	public constructor(private readonly inner: GitExecutor) {}

	public run(
		args: string[],
		cwd: string,
		listOkCodes?: number[],
		auth?: GitAuthRequest
	): Promise<string> {
		if (!writesIndex(args)) return this.inner.run(args, cwd, listOkCodes, auth);

		const previous = this.mapQueueTail.get(cwd) ?? Promise.resolve();
		// The chain is built on a swallowed copy so one command's failure never strands the queue,
		// while the caller still sees the real rejection from `turn`.
		const turn = previous.then(() => this.inner.run(args, cwd, listOkCodes, auth));
		const tail = turn
			.catch(() => undefined)
			.then(() => {
				// Last one out clears the entry, so a repository the user has closed stops being tracked.
				if (this.mapQueueTail.get(cwd) === tail) this.mapQueueTail.delete(cwd);
			});
		this.mapQueueTail.set(cwd, tail);
		return turn;
	}
}
