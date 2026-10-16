/**
 * What a change is worth re-running: the working tree alone, or the history walk as well.
 * `status` is a handful of short git commands; `graph` is the full reload.
 */
export type RefreshKind = 'status' | 'graph';

/** `graph` covers everything `status` does, so it always wins when the two meet. */
export function heavier(a: RefreshKind | null, b: RefreshKind): RefreshKind {
	return a === 'graph' || b === 'graph' ? 'graph' : 'status';
}

export interface RefreshState {
	/** The `gitOctopus.autoRefresh` setting. */
	enabled: boolean;
	/** Whether any webview is attached at all, and whether one of them is on screen. */
	hasWebview: boolean;
	visible: boolean;
	/** Whether a refresh is already running. */
	refreshing: boolean;
	/** Heaviest kind skipped while hidden, and heaviest kind waiting behind the running one. */
	missed: RefreshKind | null;
	queued: RefreshKind | null;
}

export type RefreshDecision =
	/** Nothing to do: turned off, or nothing attached that could show the result. */
	| { action: 'drop' }
	/** Hidden — remember it and run it when the view comes back. */
	| { action: 'defer'; missed: RefreshKind }
	/** Busy — let the run in flight pick it up when it finishes. */
	| { action: 'queue'; queued: RefreshKind }
	| { action: 'run'; kind: RefreshKind };

/**
 * Decide what to do with a change signal.
 *
 * Kept apart from the controller because the interesting part is the bookkeeping, not the git
 * calls: work is never done where nobody could see it, a burst of file writes must collapse into
 * one refresh rather than a queue of them, and whatever was skipped must survive until it can run.
 */
export function decideRefresh(kind: RefreshKind, state: RefreshState): RefreshDecision {
	if (!state.enabled || !state.hasWebview) return { action: 'drop' };
	if (!state.visible) return { action: 'defer', missed: heavier(state.missed, kind) };
	if (state.refreshing) return { action: 'queue', queued: heavier(state.queued, kind) };
	return { action: 'run', kind };
}

export interface RepoSnapshot {
	/** Staged plus unstaged files. */
	changeCount: number;
	/** HEAD's commit, or null when it could not be read. */
	headHash: string | null;
}

/**
 * Whether a status reply can be sent as it is, or the graph has to be reloaded behind it.
 *
 * Two things a status update cannot express. The synthetic "Uncommitted Changes" row appears and
 * disappears with the change count, and adding or removing a row is a re-layout. And a moved HEAD
 * means a history change went unseen — while the machine slept, say — so the rows on screen are
 * stale no matter what the working tree now says.
 */
export function needsFullReload(previous: RepoSnapshot, next: RepoSnapshot): boolean {
	if (previous.headHash !== null && next.headHash !== previous.headHash) return true;
	return previous.changeCount > 0 !== next.changeCount > 0;
}
