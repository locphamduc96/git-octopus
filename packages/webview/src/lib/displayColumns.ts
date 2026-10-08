/**
 * How many monospace columns a line of code takes when drawn with `white-space: pre`.
 *
 * Sizes the diff's horizontal scroll area for the whole file up front, so the bar does not change
 * size as rows are virtualised in and out. A tab runs to the next multiple of `tabSize`; East Asian
 * wide characters and emoji take two columns; combining marks take none. Approximate at the edges
 * of Unicode on purpose — the caller adds a little slack rather than measuring glyphs.
 */

const COMBINING = /\p{M}/u;
const EMOJI = /\p{Extended_Pictographic}/u;

/** Code point ranges that render two columns wide in a monospace font. */
const LIST_WIDE_RANGES: [number, number][] = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe30, 0xfe4f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x20000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
	return LIST_WIDE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

export function displayColumns(text: string, tabSize: number): number {
	let columns = 0;
	for (const char of text) {
		if (char === '\t') {
			columns += tabSize - (columns % tabSize);
			continue;
		}
		if (COMBINING.test(char)) continue;
		const codePoint = char.codePointAt(0) ?? 0;
		columns += isWide(codePoint) || EMOJI.test(char) ? 2 : 1;
	}
	return columns;
}
