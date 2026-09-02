/**
 * Whether this tick should fetch.
 *
 * The scheduler ticks on a fixed cadence and asks this every time, rather than arming a timer for
 * the user's chosen interval. Two things fall out of that: changing the setting takes effect on the
 * next tick instead of on a rebuilt timer, and a tick skipped for a transient reason — the window
 * lost focus, a rebase is open — is retried a tick later instead of costing a whole cycle.
 */
export interface AutoFetchState {
	/** The user's setting, in minutes. Zero or less means never. */
	intervalMinutes: number;
	/** Milliseconds since the last completed attempt, or null when none has run this session. */
	sinceLastMs: number | null;
	/** A fetch this scheduler started is still running. */
	busy: boolean;
	/** The window is focused. A background window has no reason to spend network or credentials. */
	focused: boolean;
	/** A merge, rebase, cherry-pick or revert is open — refs must not move under it. */
	sequencerActive: boolean;
	/** Consecutive failures so far. */
	failures: number;
}

export type AutoFetchReason =
	| 'disabled'
	| 'backedOff'
	| 'busy'
	| 'sequencer'
	| 'unfocused'
	| 'tooSoon';

export type AutoFetchDecision = { run: true } | { run: false; reason: AutoFetchReason };

/**
 * How many consecutive failures stop the schedule for the session.
 *
 * Stopping rather than backing off: the two common causes are a credential that will not authorise
 * and a network that is not there, and neither heals with time. Every retry is another password
 * prompt at someone who did not ask for one.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** The fixed cadence the scheduler ticks on, independent of the user's interval. */
export const TICK_MS = 30_000;

/**
 * Reasons are checked cheapest-and-most-permanent first, so the one reported is the one worth
 * saying. A disabled schedule that also happens to be mid-rebase is disabled, not blocked.
 */
export function planAutoFetch(state: AutoFetchState): AutoFetchDecision {
	if (state.intervalMinutes <= 0) return { run: false, reason: 'disabled' };
	if (state.failures >= MAX_CONSECUTIVE_FAILURES) return { run: false, reason: 'backedOff' };
	if (state.busy) return { run: false, reason: 'busy' };
	if (state.sequencerActive) return { run: false, reason: 'sequencer' };
	if (!state.focused) return { run: false, reason: 'unfocused' };
	// A first tick with nothing behind it fetches: the schedule is meant to start when turned on,
	// not one interval later.
	if (state.sinceLastMs !== null && state.sinceLastMs < state.intervalMinutes * 60_000)
		return { run: false, reason: 'tooSoon' };
	return { run: true };
}
