/**
 * The slice of rows worth rendering: what the viewport shows plus `overscan` rows either side,
 * so a fast scroll meets rows that already exist. Half-open [start, end), clamped to the list.
 */
export function rowWindow(
	scrollTop: number,
	viewportH: number,
	rowH: number,
	rowCount: number,
	overscan: number
): { start: number; end: number } {
	const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
	const end = Math.min(rowCount, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
	return { start, end };
}

export interface LoadMoreState {
	scrollTop: number;
	viewportH: number;
	/** Height of the whole list, not just the rendered slice. */
	totalH: number;
	rowH: number;
	rowCount: number;
	/** Row count the last load-more was asked at, so one scroll position asks only once. */
	askedAt: number;
	hasMore: boolean;
}

/** Whether scrolling has come close enough to the bottom to ask for another page of history. */
export function shouldAskLoadMore(state: LoadMoreState): boolean {
	if (!state.hasMore || state.rowCount === state.askedAt) return false;
	return state.scrollTop + state.viewportH >= state.totalH - state.rowH * 5;
}
