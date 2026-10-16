import { describe, expect, it } from 'vitest';
import { applyRanges, intralineRanges, MAX_INTRALINE_TOKENS } from './intraline';

const slice = (text: string, ranges: { start: number; end: number }[]) =>
	ranges.map((range) => text.slice(range.start, range.end));

describe('intralineRanges', () => {
	it('marks nothing on identical lines', () => {
		expect(intralineRanges('a = 1;', 'a = 1;')).toEqual({ listOld: [], listNew: [] });
	});

	it('marks only what was added inside the line', () => {
		const oldText = 'export const combo = { value: 0 };';
		const newText = 'export const combo = { value: 0, best: 0 };';
		const { listOld, listNew } = intralineRanges(oldText, newText);
		expect(listOld).toEqual([]);
		expect(slice(newText, listNew)).toEqual([', best: 0']);
	});

	it('marks the replaced word on both sides', () => {
		const oldText = 'const speed = slow + 1;';
		const newText = 'const speed = fast + 1;';
		const { listOld, listNew } = intralineRanges(oldText, newText);
		expect(slice(oldText, listOld)).toEqual(['slow']);
		expect(slice(newText, listNew)).toEqual(['fast']);
	});

	it('finds an edit in the middle with the same words around it', () => {
		const oldText = 'a b c d e f';
		const newText = 'a b X d e f';
		expect(slice(newText, intralineRanges(oldText, newText).listNew)).toEqual(['X']);
	});

	it('marks text appended to a line, however long', () => {
		const oldText = 'const tier = 10;';
		const newText =
			'const tier = 10; // a long comment that adds many more words than the line had';
		expect(slice(newText, intralineRanges(oldText, newText).listNew)).toEqual([
			' // a long comment that adds many more words than the line had',
		]);
	});

	it('marks nothing when the lines share less than half the shorter one', () => {
		expect(intralineRanges('alpha beta gamma', 'one two three four')).toEqual({
			listOld: [],
			listNew: [],
		});
	});

	it('gives up on lines too long to compare', () => {
		const long = Array.from({ length: MAX_INTRALINE_TOKENS }, (_, index) => `w${index}`).join(' ');
		expect(intralineRanges(long, `${long} x`)).toEqual({ listOld: [], listNew: [] });
	});
});

describe('applyRanges', () => {
	it('cuts syntax tokens at the range edges and marks the inside', () => {
		const listTokens = [
			{ content: 'let ', color: '#f00' },
			{ content: 'value', color: '#0f0' },
			{ content: ' = 10;' },
		];
		// "lue = 1" spans the end of one token and the start of the next.
		expect(applyRanges(listTokens, 'let value = 10;', [{ start: 6, end: 13 }])).toEqual([
			{ content: 'let ', color: '#f00' },
			{ content: 'va', color: '#0f0' },
			{ content: 'lue', color: '#0f0', emph: true },
			{ content: ' = 1', emph: true },
			{ content: '0;' },
		]);
	});

	it('stands the plain text in for missing tokens, and keeps the text whole', () => {
		const listResult = applyRanges(null, 'abcdef', [{ start: 2, end: 4 }]);
		expect(listResult.map((token) => token.content).join('')).toBe('abcdef');
		expect(listResult.filter((token) => token.emph).map((token) => token.content)).toEqual(['cd']);
	});
});
