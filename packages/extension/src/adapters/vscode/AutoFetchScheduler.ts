import {
	MAX_CONSECUTIVE_FAILURES,
	TICK_MS,
	planAutoFetch,
	type AutoFetchState,
} from '../../core/git/autoFetch.js';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { friendlyGitError } from '../../core/git/friendlyGitError.js';
import { getRepoState } from '../../core/git/gitService.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { parseRemoteHosts } from '../../core/git/remoteHosts.js';
import type { PathExists } from '../../app/ports/pathExists.js';

/** What the scheduler needs from the rest of the host, named so a test can hand it anything. */
export interface AutoFetchDeps {
	executor: GitExecutor;
	/** The repository the view is showing, or null when there is none. */
	activeRepo: () => string | null;
	/** The user's interval, in minutes. Read every tick — a change takes effect immediately. */
	intervalMinutes: () => number;
	/** Whether the editor window has focus. */
	focused: () => boolean;
	/** Milliseconds since some epoch; injected so tests need no clock. */
	now: () => number;
	/** Whether a path is there — how an open merge or rebase is detected. */
	pathExists: PathExists;
	/** Called after a fetch that changed something, so the graph can reload. */
	onFetched: () => void;
	/** Told once, when the schedule gives up for the session. */
	onGaveUp: (message: string) => void;
}

/**
 * Fetches on a schedule so the drift shown on branch chips is about the repository as it is, not as
 * it was whenever the user last fetched by hand.
 *
 * Fetch only, never pull: fetch leaves the checked-out branch exactly where it was, so nothing the
 * user is working on moves underneath them. Closing the gap stays a decision they make.
 */
export class AutoFetchScheduler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private lastAt: number | null = null;
	private busy = false;
	private failures = 0;
	/** The warning is shown once per giving-up, not once per tick after it. */
	private warned = false;
	/** The interval last seen, so changing the setting can be recognised as a fresh start. */
	private lastInterval: number | null = null;

	public constructor(private readonly deps: AutoFetchDeps) {}

	public start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), TICK_MS);
	}

	public dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** One scheduled decision. Exposed for tests; the timer is the only production caller. */
	public async tick(): Promise<void> {
		const cwd = this.deps.activeRepo();
		if (!cwd) return;

		// Changing the setting is the user saying "try again": the thing that was failing may be the
		// very thing they just went and fixed, and there is no other gesture that means this.
		const intervalMinutes = this.deps.intervalMinutes();
		if (this.lastInterval !== null && intervalMinutes !== this.lastInterval) {
			this.failures = 0;
			this.warned = false;
		}
		this.lastInterval = intervalMinutes;

		const state: AutoFetchState = {
			intervalMinutes,
			sinceLastMs: this.lastAt === null ? null : this.deps.now() - this.lastAt,
			busy: this.busy,
			focused: this.deps.focused(),
			// Answered below rather than here: the probe hits the filesystem, and there is no reason
			// to pay for it on a tick that a cheaper reason has already ruled out.
			sequencerActive: false,
			failures: this.failures,
		};
		if (!planAutoFetch(state).run) return;
		if ((await getRepoState(this.deps.executor, cwd, this.deps.pathExists)) !== null) return;

		this.busy = true;
		this.lastAt = this.deps.now();
		try {
			await this.deps.executor.run(['fetch', '--all', '--prune'], cwd, undefined, {
				operation: 'fetch',
				listHosts: await this.remoteHosts(cwd),
			});
			this.failures = 0;
			this.deps.onFetched();
		} catch (err) {
			this.failures += 1;
			if (this.failures >= MAX_CONSECUTIVE_FAILURES && !this.warned) {
				this.warned = true;
				this.deps.onGaveUp(this.describe(err));
			}
		} finally {
			this.busy = false;
		}
	}

	/** The hosts a credential prompt may be shown for, resolved before the spawn — never from text. */
	private async remoteHosts(cwd: string): Promise<string[]> {
		try {
			return parseRemoteHosts(await this.deps.executor.run(['remote', '-v'], cwd));
		} catch {
			return [];
		}
	}

	private describe(err: unknown): string {
		const raw = redactSecrets(err instanceof Error ? err.message : String(err));
		return friendlyGitError(raw) ?? raw;
	}
}
