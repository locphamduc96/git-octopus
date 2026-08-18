import type { RefChip } from './graphChips';

/** What the ref column looks like right now, as far as expanding is concerned. */
export interface ExpandState {
	listChips: RefChip[];
	/** Whether any chip is folded away behind the `+N` badge. */
	hasOverflow: boolean;
	/** Whether any name it does show has been cut down to an ellipsis. */
	isTruncated: boolean;
}

/**
 * Whether hovering the ref column should expand it.
 *
 * Only when something is actually being withheld. The column lies along the path of every pointer
 * crossing the graph, so a panel that opened on every row would spend most of its life covering
 * rows nobody asked about — and covering them with a copy of what they already say.
 */
export function shouldExpand(state: ExpandState): boolean {
	if (state.listChips.length === 0) return false;
	return state.hasOverflow || state.isTruncated;
}

/**
 * Where the expanded column hangs, in viewport coordinates.
 *
 * Anchored on the first chip rather than on the cell: the panel's own first chip has to land on
 * exactly the chip it replaces, so the column reads as that chip opening up rather than as a
 * separate surface arriving from somewhere else. `padding` is the panel's, subtracted so the chip
 * inside it — not the panel edge — is what lines up.
 *
 * Right-anchored because the names grow leftwards: their tails are what a reader is missing, and
 * a left-anchored panel would put the tails wherever each name happened to end.
 */
export function expanderAnchor(
	firstChip: { top: number; right: number },
	padding: number,
	windowWidth: number
): { right: number; y: number } {
	return { right: windowWidth - firstChip.right - padding, y: firstChip.top - padding };
}

/**
 * The same anchor, pulled back inside the viewport.
 *
 * Ref names run long and the panel grows leftwards from its anchor, so on a narrow editor pane the
 * far end of the longest name walks off the left edge — the end of the name being, of course, the
 * part the reader opened the panel for. Sliding the panel right keeps the whole name on screen;
 * the anchor is a preference, and legibility outranks it.
 */
export function clampExpandRight(
	right: number,
	panelWidth: number,
	windowWidth: number,
	margin: number
): number {
	// Nothing measured yet — leave the preferred anchor alone rather than guess at a correction.
	if (panelWidth <= 0) return right;
	const widest = windowWidth - panelWidth - margin;
	return Math.max(margin, Math.min(right, widest));
}
