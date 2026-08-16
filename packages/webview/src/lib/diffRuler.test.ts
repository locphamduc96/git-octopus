import { describe, expect, it } from 'vitest';
import { computeRulerMarks, type RulerRowKind } from './diffRuler';

/** `count` rows of `kind`, for building files without writing every row out. */
const rows = (kind: RulerRowKind, count: number): RulerRowKind[] => Array(count).fill(kind);

describe('computeRulerMarks', () => {
	it('returns nothing for an empty file', () => {
		expect(computeRulerMarks([])).toEqual([]);
	});

	it('marks a pure run with its position and share of the file', () => {
		const listMarks = computeRulerMarks([
			...rows('context', 25),
			...rows('add', 50),
			...rows('context', 25),
		]);
		expect(listMarks).toEqual([{ start: 25, top: 25, height: 50, kind: 'add' }]);
	});

	it('keeps a single changed line visible via the minimum height', () => {
		const listMarks = computeRulerMarks([...rows('context', 999), 'del']);
		expect(listMarks).toEqual([{ start: 999, top: 99.9, height: 0.6, kind: 'del' }]);
	});

	it('stacks a mixed run as red over green in line proportions', () => {
		const listMarks = computeRulerMarks([
			...rows('context', 40),
			...rows('del', 10),
			...rows('add', 30),
			...rows('context', 20),
		]);
		expect(listMarks).toEqual([
			{ start: 40, top: 40, height: 10, kind: 'del' },
			{ start: 40, top: 50, height: 30, kind: 'add' },
		]);
	});

	it('clamps the smaller side of a lopsided mixed run instead of losing it', () => {
		const listMarks = computeRulerMarks([...rows('del', 199), 'add']);
		expect(listMarks).toHaveLength(2);
		expect(listMarks[0].kind).toBe('del');
		expect(listMarks[0].height).toBeCloseTo(99.4);
		expect(listMarks[1].kind).toBe('add');
		expect(listMarks[1].top).toBeCloseTo(99.4);
		expect(listMarks[1].height).toBeCloseTo(0.6);
	});

	it('falls back to one both-coloured mark when the run is too short to split', () => {
		const listMarks = computeRulerMarks([...rows('context', 998), 'del', 'add']);
		expect(listMarks).toEqual([{ start: 998, top: 99.8, height: 0.6, kind: 'both' }]);
	});

	it('is cut into separate runs by context and by hunk gaps', () => {
		const listMarks = computeRulerMarks([
			'gap',
			...rows('add', 4),
			...rows('context', 5),
			...rows('del', 5),
			'gap',
			...rows('add', 5),
		]);
		expect(listMarks.map((mark) => mark.kind)).toEqual(['add', 'del', 'add']);
		expect(listMarks.map((mark) => mark.start)).toEqual([1, 10, 16]);
	});
});
