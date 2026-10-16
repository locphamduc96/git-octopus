import type { DiffHunk, DiffLine } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import {
	buildDiffRows,
	mapLinePartners,
	isChangeRow,
	prefixLines,
	rowAtLine,
	rowColumns,
	rowLineCounts,
	rulerKind,
	type DiffRow,
} from './diffRows';
import { computeRulerMarks } from './diffRuler';

const ctx = (text: string): DiffLine => ({ kind: 'context', text, oldLine: 1, newLine: 1 });
const del = (text: string): DiffLine => ({ kind: 'del', text, oldLine: 1, newLine: null });
const add = (text: string): DiffLine => ({ kind: 'add', text, oldLine: null, newLine: 1 });

function hunk(listLines: DiffLine[]): DiffHunk {
	return { oldStart: 1, newStart: 1, heading: 'h', listLines };
}

/** A row as `left|right` text, `·` for an empty side, so a whole layout reads in one assertion. */
function describeRow(row: DiffRow): string {
	if (row.kind === 'gap') return 'gap';
	if (row.kind === 'line') return row.cell.line.text;
	return `${row.left?.line.text ?? '·'}|${row.right?.line.text ?? '·'}`;
}

describe('buildDiffRows', () => {
	const listHunks = [hunk([ctx('a'), del('b1'), del('b2'), add('B1'), ctx('c'), add('d')])];

	it('keeps unified lines in order, with a gap row per hunk when asked', () => {
		expect(buildDiffRows(listHunks, 'unified', true).map(describeRow)).toEqual([
			'gap',
			'a',
			'b1',
			'b2',
			'B1',
			'c',
			'd',
		]);
		expect(buildDiffRows(listHunks, 'unified', false).map(describeRow)).not.toContain('gap');
	});

	it('pairs a deletion run with the addition run after it, leaving the surplus empty', () => {
		expect(buildDiffRows(listHunks, 'split', false).map(describeRow)).toEqual([
			'a|a',
			'b1|B1',
			'b2|·',
			'c|c',
			'·|d',
		]);
	});

	it('keeps each side indexed to its own line, for the syntax tokens', () => {
		const listRows = buildDiffRows(listHunks, 'split', false);
		const pair = listRows[1];
		if (pair.kind !== 'pair') throw new Error('expected a pair');
		expect(pair.left?.lineIndex).toBe(1);
		expect(pair.right?.lineIndex).toBe(3);
	});

	it('does not pair an addition with a deletion that comes after it', () => {
		const listRows = buildDiffRows([hunk([add('x'), del('y')])], 'split', false);
		expect(listRows.map(describeRow)).toEqual(['·|x', 'y|·']);
	});
});

describe('rulerKind and isChangeRow', () => {
	it('reads a pair that both removes and adds as both, and context as no change', () => {
		const listRows = buildDiffRows(
			[hunk([ctx('a'), del('b'), add('B'), del('only')])],
			'split',
			false
		);
		expect(listRows.map(rulerKind)).toEqual(['context', 'both', 'del']);
		expect(listRows.map(isChangeRow)).toEqual([false, true, true]);
	});
});

describe('wrapping', () => {
	it('counts the marker column and the taller side of a pair', () => {
		const listRows = buildDiffRows(
			[hunk([del('x'.repeat(9)), add('y'.repeat(25))])],
			'split',
			false
		);
		expect(rowColumns(listRows[0], 8)).toEqual([10, 26]);
		expect(
			rowLineCounts(
				listRows.map((row) => rowColumns(row, 8)),
				10
			)
		).toEqual([3]);
	});

	it('is one line per row without wrapping, and never less than one', () => {
		expect(rowLineCounts([[500], []], null)).toEqual([1, 1]);
		expect(rowLineCounts([[0], []], 10)).toEqual([1, 1]);
	});

	it('finds the row on screen from a line offset', () => {
		const listTops = prefixLines([1, 3, 1, 2]);
		expect(listTops).toEqual([0, 1, 4, 5, 7]);
		expect(rowAtLine(listTops, 0)).toBe(0);
		expect(rowAtLine(listTops, 1)).toBe(1);
		expect(rowAtLine(listTops, 3)).toBe(1);
		expect(rowAtLine(listTops, 4)).toBe(2);
		expect(rowAtLine(listTops, 99)).toBe(3);
	});
});

describe('computeRulerMarks with weights', () => {
	it('places a mark by line height rather than by row count', () => {
		const listMarks = computeRulerMarks(['context', 'add'], [3, 1]);
		expect(listMarks).toEqual([{ start: 1, top: 75, height: 25, kind: 'add' }]);
	});

	it('stacks a both-sided row as a deletion over an addition', () => {
		const listMarks = computeRulerMarks(['both', 'context'], [10, 10]);
		expect(listMarks.map((mark) => mark.kind)).toEqual(['del', 'add']);
	});
});

describe('mapLinePartners', () => {
	it('pairs each deletion with the addition at the same place in the run that follows', () => {
		const line = (kind: 'add' | 'del' | 'context', text: string) => ({
			kind,
			text,
			oldLine: null,
			newLine: null,
		});
		const mapPartners = mapLinePartners([
			{
				oldStart: 1,
				newStart: 1,
				heading: '',
				listLines: [line('context', 'a'), line('del', 'b'), line('del', 'c'), line('add', 'B')],
			},
			{ oldStart: 9, newStart: 9, heading: '', listLines: [line('del', 'x'), line('add', 'X')] },
		]);
		expect([...mapPartners]).toEqual([
			[1, 3],
			[3, 1],
			[4, 5],
			[5, 4],
		]);
	});
});
