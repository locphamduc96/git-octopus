/**
 * What to do when something asks the graph to show a commit.
 *
 * The graph holds a page of history, not all of it, so a hash worth scrolling to may simply not
 * be loaded yet — the detached-HEAD banner names one the walk has not reached, and a branch tip
 * can sit below the last row. Loading more and asking again is the answer, up to a point; past
 * that the honest move is to say so rather than leave a button that does nothing.
 */
export type RevealStep =
	/** The row is loaded: select and scroll to it. */
	| { kind: 'reveal' }
	/** Not loaded, but there is more history and budget to fetch it. */
	| { kind: 'loadMore' }
	/** Nowhere left to look. */
	| { kind: 'giveUp' };

export interface RevealState {
	loaded: boolean;
	/** Whether history continues past the loaded rows. */
	hasMore: boolean;
	/** Pages still worth fetching before admitting defeat. */
	pagesLeft: number;
}

export function planReveal(state: RevealState): RevealStep {
	if (state.loaded) return { kind: 'reveal' };
	if (state.hasMore && state.pagesLeft > 0) return { kind: 'loadMore' };
	return { kind: 'giveUp' };
}
