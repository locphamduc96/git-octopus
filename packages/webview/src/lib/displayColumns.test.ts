import { describe, expect, it } from 'vitest';
import { displayColumns } from './displayColumns';

describe('displayColumns', () => {
	it('counts one column per ASCII character', () => {
		expect(displayColumns('import { cn } from "@/lib/classNames";', 8)).toBe(38);
	});

	it('runs a tab to the next tab stop, wherever it sits in the line', () => {
		expect(displayColumns('\tx', 8)).toBe(9);
		expect(displayColumns('ab\tx', 8)).toBe(9);
		expect(displayColumns('abcdefgh\tx', 8)).toBe(17);
		expect(displayColumns('ab\tx', 4)).toBe(5);
	});

	it('follows the editor tab size it is given', () => {
		expect(displayColumns('\t\tx', 2)).toBe(5);
		expect(displayColumns('\t\tx', 4)).toBe(9);
		expect(displayColumns('a\tb', 2)).toBe(3);
	});

	it('counts precomposed Vietnamese as one column each, and bare combining marks as none', () => {
		expect(displayColumns('Ngày điều tra', 8)).toBe(13);
		expect(displayColumns('é', 8)).toBe(1);
	});

	it('counts CJK and emoji as two columns', () => {
		expect(displayColumns('象棋', 8)).toBe(4);
		expect(displayColumns('ok 🎉', 8)).toBe(5);
	});

	it('is zero for an empty line', () => {
		expect(displayColumns('', 8)).toBe(0);
	});
});
