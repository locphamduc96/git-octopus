import { describe, expect, it } from 'vitest';
import { nextRowIndex } from './keyNav';

const LAST = 9;
const JUMP = 20;

describe('nextRowIndex', () => {
	it('steps one row with the arrows and clamps at both ends', () => {
		expect(nextRowIndex('ArrowUp', 5, LAST, JUMP)).toBe(4);
		expect(nextRowIndex('ArrowUp', 0, LAST, JUMP)).toBe(0);
		expect(nextRowIndex('ArrowDown', 5, LAST, JUMP)).toBe(6);
		expect(nextRowIndex('ArrowDown', LAST, LAST, JUMP)).toBe(LAST);
	});

	it('pages by pageJump and clamps', () => {
		expect(nextRowIndex('PageUp', 5, 100, JUMP)).toBe(0);
		expect(nextRowIndex('PageUp', 50, 100, JUMP)).toBe(30);
		expect(nextRowIndex('PageDown', 5, LAST, JUMP)).toBe(LAST);
		expect(nextRowIndex('PageDown', 5, 100, JUMP)).toBe(25);
	});

	it('jumps to the edges with Home and End', () => {
		expect(nextRowIndex('Home', 5, LAST, JUMP)).toBe(0);
		expect(nextRowIndex('End', 5, LAST, JUMP)).toBe(LAST);
	});

	it('starts from the top while nothing is selected', () => {
		expect(nextRowIndex('ArrowUp', -1, LAST, JUMP)).toBe(0);
		expect(nextRowIndex('ArrowDown', -1, LAST, JUMP)).toBe(0);
		expect(nextRowIndex('PageUp', -1, LAST, JUMP)).toBe(0);
		expect(nextRowIndex('PageDown', -1, LAST, JUMP)).toBe(LAST);
		expect(nextRowIndex('PageDown', -1, 100, JUMP)).toBe(JUMP);
		expect(nextRowIndex('End', -1, LAST, JUMP)).toBe(LAST);
	});
});
