/**
 * Where list navigation lands next. ↑/↓ step by one, PageUp/PageDown by `pageJump`, Home/End
 * jump to the edges — all clamped to [0, last]. `current` is -1 while nothing is selected, and
 * every key then starts from the top rather than nowhere.
 */
export function nextRowIndex(key: string, current: number, last: number, pageJump: number): number {
	switch (key) {
		case 'ArrowUp':
			return current <= 0 ? 0 : current - 1;
		case 'ArrowDown':
			return current === -1 ? 0 : Math.min(last, current + 1);
		case 'PageUp':
			return Math.max(0, (current === -1 ? 0 : current) - pageJump);
		case 'PageDown':
			return Math.min(last, (current === -1 ? 0 : current) + pageJump);
		case 'Home':
			return 0;
		// `key` is a raw DOM string, not a closed union, so End cannot be a case with an exhaustive
		// arm behind it — every key the caller routes here that is not listed above means End.
		default:
			return last;
	}
}

/**
 * The next row on the same branch line, walking `step` rows at a time from `current`.
 *
 * Moving *along a branch* rather than along time. The graph's rows are ordered by date, so on a
 * busy repository the commit visually below a node usually belongs to somebody else's lane; ↑/↓
 * walk that order, and this walks the structure the graph actually drew.
 *
 * Returns `current` when there is nothing further on the lane — the selection stays put rather than
 * jumping to an unrelated commit, which is the one outcome that would make the key untrustworthy.
 */
export function stepAlongLane(
	listBranches: number[],
	current: number,
	step: 1 | -1
): number {
	if (current < 0 || current >= listBranches.length) return current;
	const lane = listBranches[current];
	for (let index = current + step; index >= 0 && index < listBranches.length; index += step) {
		if (listBranches[index] === lane) return index;
	}
	return current;
}

/**
 * The nearest row on the lane immediately to one side of `current`'s.
 *
 * Lanes are columns, so "left" and "right" mean the columns either side of this node's; the row
 * chosen on that column is the one nearest in display order, searching outward from `current` so a
 * press lands next to where the eye already is.
 */
export function stepAcrossLanes(
	listColumns: number[],
	current: number,
	direction: 1 | -1
): number {
	if (current < 0 || current >= listColumns.length) return current;
	const column = listColumns[current];
	let best = current;
	let bestDistance = Infinity;
	// Seeded at the far end of the direction being searched: going left, the best column is the
	// largest one still to the left, so a seed of `Infinity` would never be beaten.
	let bestColumn = direction === 1 ? Infinity : -Infinity;
	for (let index = 0; index < listColumns.length; index += 1) {
		const candidate = listColumns[index];
		// Strictly on the requested side, and the nearest such column wins before distance does:
		// skipping a whole lane because one of its commits happens to be closer reads as a jump.
		if (direction === 1 ? candidate <= column : candidate >= column) continue;
		const distance = Math.abs(index - current);
		const nearerColumn =
			direction === 1 ? candidate < bestColumn : candidate > bestColumn;
		if (nearerColumn || (candidate === bestColumn && distance < bestDistance)) {
			best = index;
			bestDistance = distance;
			bestColumn = candidate;
		}
	}
	return best;
}
