/**
 * Marks for the diff overview ruler: runs of changed rows as a share of the whole file.
 *
 * A run of deletions immediately followed by additions is drawn as red stacked over green in the
 * two sides' real proportions — deletions come first inside a unified-diff change block, so the
 * stacking order matches the rows. Only a run too short to hold both colours falls back to one
 * half-red half-green mark; a third "modified" colour never appears, because a diff is read in
 * terms of + and −.
 */
export type RulerRowKind = 'add' | 'del' | 'context' | 'gap';

export interface RulerMark {
	/** Row index where the run starts. With `kind` it forms a stable render key. */
	start: number;
	/** Percentages of the whole file, ready for `top`/`height` in CSS. */
	top: number;
	height: number;
	kind: 'add' | 'del' | 'both';
}

/** A single changed line in a 3000-line file rounds to nothing; keep it visible. */
const MIN_HEIGHT = 0.6;

export function computeRulerMarks(listKinds: RulerRowKind[]): RulerMark[] {
	const total = listKinds.length;
	if (total === 0) return [];
	const listResult: RulerMark[] = [];
	let start = -1;
	let delCount = 0;
	let addCount = 0;
	const flush = (end: number): void => {
		if (start === -1) return;
		const top = (start / total) * 100;
		const height = ((end - start) / total) * 100;
		if (delCount > 0 && addCount > 0 && height >= 2 * MIN_HEIGHT) {
			// The clamp keeps a 1-line side visible against a 50-line one without ever squeezing
			// the other side below the minimum either.
			const raw = height * (delCount / (delCount + addCount));
			const delHeight = Math.min(Math.max(raw, MIN_HEIGHT), height - MIN_HEIGHT);
			listResult.push({ start, top, height: delHeight, kind: 'del' });
			listResult.push({ start, top: top + delHeight, height: height - delHeight, kind: 'add' });
		} else {
			const kind = delCount > 0 && addCount > 0 ? 'both' : delCount > 0 ? 'del' : 'add';
			listResult.push({ start, top, height: Math.max(MIN_HEIGHT, height), kind });
		}
		start = -1;
		delCount = 0;
		addCount = 0;
	};
	listKinds.forEach((kind, index) => {
		if (kind === 'context' || kind === 'gap') {
			flush(index);
			return;
		}
		if (start === -1) start = index;
		if (kind === 'add') addCount++;
		else delCount++;
	});
	flush(total);
	return listResult;
}
