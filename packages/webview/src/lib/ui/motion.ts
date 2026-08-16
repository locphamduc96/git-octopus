/**
 * Durations for transitions that Svelte drives from JavaScript — the ones that have to run while an
 * element is being removed, which CSS alone cannot do because the node is already gone by then.
 * Anything that only plays on the way in stays in `tokens.css` as a class.
 *
 * Read per call rather than at import: the setting can change while the window is open, and a
 * duration frozen at load would keep animating for someone who has just asked it not to.
 */
export type MotionSpeed = 'fast' | 'base' | 'exit';

const mapDuration: Record<MotionSpeed, number> = {
	fast: 90,
	base: 130,
	/* Leaving is a touch quicker than arriving: the answer is already known, so waiting on it grates. */
	exit: 110,
};

export function motionMs(speed: MotionSpeed): number {
	const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
	return reduced ? 0 : mapDuration[speed];
}
