import type { DiffHunk, DiffLine } from '@git-octopus/shared';
import { displayColumns } from './displayColumns';
import type { RulerRowKind } from './diffRuler';

export type DiffLayout = 'unified' | 'split';

/** One diff line and its position in the flat line list the syntax tokens are indexed by. */
export interface LineCell {
	line: DiffLine;
	lineIndex: number;
}

export type DiffRow =
	| { kind: 'gap'; heading: string; label: string; hunkIndex: number }
	| { kind: 'line'; cell: LineCell }
	/** Split view: old on the left, new on the right; null is the empty side of a lone add or del. */
	| { kind: 'pair'; left: LineCell | null; right: LineCell | null };

/**
 * Hunks flattened into rows, each hunk preceded by its separator when `withGaps` is set.
 *
 * Split view pairs a run of deletions with the run of additions straight after it, line by line —
 * the usual reading of "these lines became those". Whatever one side has more of sits against an
 * empty cell. Context lines are the same text on both sides.
 */
export function buildDiffRows(
	listHunks: DiffHunk[],
	layout: DiffLayout,
	withGaps: boolean
): DiffRow[] {
	const listRows: DiffRow[] = [];
	let lineIndex = 0;
	listHunks.forEach((hunk, hunkIndex) => {
		if (withGaps) {
			listRows.push({
				kind: 'gap',
				heading: hunk.heading,
				label: `@@ -${hunk.oldStart} +${hunk.newStart} @@`,
				hunkIndex,
			});
		}
		const listCells = hunk.listLines.map((line) => ({ line, lineIndex: lineIndex++ }));
		if (layout === 'unified') {
			for (const cell of listCells) listRows.push({ kind: 'line', cell });
			return;
		}
		let index = 0;
		while (index < listCells.length) {
			const cell = listCells[index];
			if (cell.line.kind === 'context') {
				listRows.push({ kind: 'pair', left: cell, right: cell });
				index++;
				continue;
			}
			const listDels: LineCell[] = [];
			while (index < listCells.length && listCells[index].line.kind === 'del') {
				listDels.push(listCells[index++]);
			}
			const listAdds: LineCell[] = [];
			while (index < listCells.length && listCells[index].line.kind === 'add') {
				listAdds.push(listCells[index++]);
			}
			for (let k = 0; k < Math.max(listDels.length, listAdds.length); k++) {
				listRows.push({ kind: 'pair', left: listDels[k] ?? null, right: listAdds[k] ?? null });
			}
		}
	});
	return listRows;
}

/**
 * Each deleted line's added counterpart, and back, by the flat line index the rows use: within a
 * hunk, a run of deletions pairs with the run of additions straight after it, line by line — the
 * same reading split view draws.
 */
export function mapLinePartners(listHunks: DiffHunk[]): Map<number, number> {
	const mapPartners = new Map<number, number>();
	let lineIndex = 0;
	for (const hunk of listHunks) {
		const listLines = hunk.listLines;
		let index = 0;
		while (index < listLines.length) {
			if (listLines[index].kind !== 'del') {
				index++;
				continue;
			}
			const listDels: number[] = [];
			while (index < listLines.length && listLines[index].kind === 'del')
				listDels.push(lineIndex + index++);
			const listAdds: number[] = [];
			while (index < listLines.length && listLines[index].kind === 'add')
				listAdds.push(lineIndex + index++);
			for (let k = 0; k < Math.min(listDels.length, listAdds.length); k++) {
				mapPartners.set(listDels[k], listAdds[k]);
				mapPartners.set(listAdds[k], listDels[k]);
			}
		}
		lineIndex += listLines.length;
	}
	return mapPartners;
}

/** What a row contributes to the overview ruler. */
export function rulerKind(row: DiffRow): RulerRowKind {
	if (row.kind === 'gap') return 'gap';
	if (row.kind === 'line') return row.cell.line.kind === 'context' ? 'context' : row.cell.line.kind;
	const del = row.left?.line.kind === 'del';
	const add = row.right?.line.kind === 'add';
	if (del && add) return 'both';
	if (del) return 'del';
	if (add) return 'add';
	return 'context';
}

/** Whether the row shows a change on either side — what stepping between changes lands on. */
export function isChangeRow(row: DiffRow): boolean {
	const kind = rulerKind(row);
	return kind !== 'context' && kind !== 'gap';
}

/**
 * The columns each side of a row needs, the `+`/`-` marker included: one entry for a unified line,
 * two for a split pair (0 for an empty side), none for a gap — its label is clipped, never wrapped.
 */
export function rowColumns(row: DiffRow, tabSize: number): number[] {
	const width = (cell: LineCell | null): number =>
		cell === null ? 0 : displayColumns(cell.line.text, tabSize) + 1;
	if (row.kind === 'gap') return [];
	if (row.kind === 'line') return [width(row.cell)];
	return [width(row.left), width(row.right)];
}

/**
 * How many screen lines each row takes. Without wrapping every row is one line; with it, a row is
 * as tall as its taller side needs at `columnsPerLine` columns a line.
 */
export function rowLineCounts(listRowColumns: number[][], columnsPerLine: number | null): number[] {
	if (columnsPerLine === null) return listRowColumns.map(() => 1);
	const perLine = Math.max(1, columnsPerLine);
	return listRowColumns.map((listColumns) =>
		Math.max(1, ...listColumns.map((columns) => Math.ceil(columns / perLine)))
	);
}

/** Running totals: entry `i` is the line the row `i` starts on; the last entry is the total. */
export function prefixLines(listCounts: number[]): number[] {
	const listTops = [0];
	for (const count of listCounts) listTops.push(listTops[listTops.length - 1] + count);
	return listTops;
}

/** The row on screen at `line` lines from the top: the last row starting at or before it. */
export function rowAtLine(listTops: number[], line: number): number {
	const rowCount = listTops.length - 1;
	if (rowCount <= 0) return 0;
	let low = 0;
	let high = rowCount - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (listTops[mid] <= line) low = mid;
		else high = mid - 1;
	}
	return low;
}

/** The identity a changed line is picked by: its line number on the side it lives on. */
export function pickKey(line: DiffLine): string | null {
	if (line.kind === 'add') return `a:${line.newLine}`;
	if (line.kind === 'del') return `d:${line.oldLine}`;
	return null;
}
