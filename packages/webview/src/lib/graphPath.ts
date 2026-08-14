export type GraphStyle = 'rounded' | 'angular';

export interface EdgeGeometry {
	/** Column centres, in pixels. */
	x1: number;
	x2: number;
	/** Row centres, in pixels. */
	yTop: number;
	yBottom: number;
	/**
	 * How far each end has to stop short of a node's centre. Zero when that end is not a node but a
	 * lane simply running on, which must not be shortened or the line breaks in two.
	 */
	fromRadius: number;
	toRadius: number;
	style: GraphStyle;
}

/**
 * The SVG path for one lane segment, from a row down to the next.
 *
 * A lane that changes column turns **as late as it can**: it runs straight down the column it starts
 * in and swings across at the bottom. Turning early instead makes the curve bulge upwards and leaves
 * the run below it out of step with every other lane.
 *
 * Where it can finish the turn depends on what it lands on:
 *
 * - a node — it arrives sideways, into the node's edge, and the turn is a single quarter bend;
 * - a lane carrying on below — it has to arrive vertical for that lane to pick it up, which no
 *   single bend can do, so it takes a curve weighted to the bottom instead.
 */
export function edgePath(geometry: EdgeGeometry): string {
	const { x1, x2, yTop, yBottom, fromRadius, toRadius, style } = geometry;
	const yStart = yTop + fromRadius;

	if (x1 === x2) return `M${x1} ${yStart} L${x2} ${yBottom - toRadius}`;

	const dir = Math.sign(x2 - x1);

	if (style === 'angular') {
		const ym = (yTop + yBottom) / 2;
		return `M${x1} ${yStart} L${x1} ${ym} L${x2} ${ym} L${x2} ${yBottom - toRadius}`;
	}

	if (toRadius > 0) {
		const endX = x2 - dir * toRadius;
		const r = Math.max(0, Math.min(Math.abs(endX - x1), yBottom - yStart));
		return `M${x1} ${yStart} L${x1} ${yBottom - r} Q${x1} ${yBottom} ${endX} ${yBottom}`;
	}

	// Both control points sit low and directly under their own end: the line leaves and arrives
	// vertical, and all the sideways movement happens near the bottom. Capped at half the segment,
	// since a control point above the halfway mark drags the bulge back up.
	const t = Math.max(0, Math.min(Math.abs(x2 - x1), (yBottom - yStart) / 2));
	return `M${x1} ${yStart} C${x1} ${yBottom - t} ${x2} ${yBottom - t} ${x2} ${yBottom}`;
}
