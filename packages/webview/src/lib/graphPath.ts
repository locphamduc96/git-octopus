export type GraphStyle = 'rounded' | 'curved' | 'angular' | 'diagonal';

export interface LaneMetrics {
	/** Distance between lane centres. */
	columnWidth: number;
	/** Height of one row — every path runs from y=0 to y=rowHeight, or stops at the node halfway. */
	rowHeight: number;
	/** Left inset of the first lane. */
	padding: number;
	/** How far a bend is rounded off. The `curved` style ignores this and bends as far as it can. */
	curve: number;
	style: GraphStyle;
}

export function laneX(column: number, m: LaneMetrics): number {
	return m.padding + column * m.columnWidth;
}

/**
 * A lane crossing the whole row without changing column.
 *
 * Every path here is drawn inside one row's own band, from its top edge to its bottom edge or to the
 * node at its centre. Rows therefore line up by construction: whatever leaves the bottom of one row
 * enters the top of the next in the same column, so no path ever has to know what the neighbouring
 * row looks like. Nodes are drawn over the paths afterwards and mask what runs behind them, which is
 * why nothing here stops short of a node.
 */
export function passThrough(column: number, m: LaneMetrics): string {
	const x = laneX(column, m);
	return `M${x} 0 L${x} ${m.rowHeight}`;
}

/** The node's own line above it: from the top edge down to the node. */
export function intoNode(column: number, m: LaneMetrics): string {
	const x = laneX(column, m);
	return `M${x} 0 L${x} ${m.rowHeight / 2}`;
}

/** The node's own line below it: from the node down to the bottom edge. */
export function outOfNode(column: number, m: LaneMetrics): string {
	const x = laneX(column, m);
	return `M${x} ${m.rowHeight / 2} L${x} ${m.rowHeight}`;
}

/**
 * A lane arriving from above and merging into this row's node: straight down its own column, then a
 * bend into the node's level and across. The bend sits in the upper half, mirroring `branchOut`.
 */
export function mergeIn(fromColumn: number, nodeColumn: number, m: LaneMetrics): string {
	const x = laneX(fromColumn, m);
	const nodeX = laneX(nodeColumn, m);
	const mid = m.rowHeight / 2;
	const dir = Math.sign(nodeX - x);
	if (m.style === 'angular') return `M${x} 0 L${x} ${mid} L${nodeX} ${mid}`;
	if (m.style === 'diagonal') {
		const run = diagonalRun(x, nodeX, mid);
		const turnX = x + dir * run;
		// The level run only exists when the crossing is wider than the diagonal may be tall.
		const level = turnX === nodeX ? '' : ` L${nodeX} ${mid}`;
		return `M${x} 0 L${x} ${mid - run} L${turnX} ${mid}${level}`;
	}
	const r = bendRadius(x, nodeX, mid, m);
	return `M${x} 0 L${x} ${mid - r} Q${x} ${mid} ${x + dir * r} ${mid} L${nodeX} ${mid}`;
}

/**
 * A lane leaving this row's node for another column — a merge's extra parent, or a first parent that
 * belongs to a lane already running elsewhere. Across at the node's level, then a bend down into the
 * column it is joining, so the curve bulges underneath.
 */
export function branchOut(nodeColumn: number, toColumn: number, m: LaneMetrics): string {
	const nodeX = laneX(nodeColumn, m);
	const x = laneX(toColumn, m);
	const mid = m.rowHeight / 2;
	const dir = Math.sign(x - nodeX);
	if (m.style === 'angular') return `M${nodeX} ${mid} L${x} ${mid} L${x} ${m.rowHeight}`;
	if (m.style === 'diagonal') {
		const run = diagonalRun(nodeX, x, mid);
		const turnX = x - dir * run;
		const level = turnX === nodeX ? '' : ` L${turnX} ${mid}`;
		return `M${nodeX} ${mid}${level} L${x} ${mid + run} L${x} ${m.rowHeight}`;
	}
	const r = bendRadius(nodeX, x, mid, m);
	return `M${nodeX} ${mid} L${x - dir * r} ${mid} Q${x} ${mid} ${x} ${mid + r} L${x} ${m.rowHeight}`;
}

/**
 * Never bend further than the gap being crossed, nor further than the half-row it happens in. The
 * `curved` style takes that whole allowance: the straight run all but disappears and the lane reads
 * as one continuous arc. Its tangent at the row edge stays vertical either way, so rows still line
 * up with each other.
 */
function bendRadius(fromX: number, toX: number, half: number, m: LaneMetrics): number {
	const limit = m.style === 'curved' ? Infinity : m.curve;
	return Math.max(0, Math.min(limit, Math.abs(toX - fromX), half));
}

/**
 * How much height the diagonal takes: as much as it is wide, which is what makes it 45°, but never
 * more than the half-row it has to fit in. A path is drawn inside its own row and nowhere else —
 * that is what lets rows line up without any of them knowing about its neighbours — so a lane
 * crossing further than the row is tall keeps the 45° and runs level for the rest, rather than
 * flattening the diagonal out across the whole gap.
 */
function diagonalRun(fromX: number, toX: number, half: number): number {
	return Math.min(Math.abs(toX - fromX), half);
}
