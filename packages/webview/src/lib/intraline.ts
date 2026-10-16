import type { HighlightToken } from './highlight';

/** A half-open run of characters, `[start, end)`, within one line's text. */
export interface CharRange {
	start: number;
	end: number;
}

interface Token {
	text: string;
	start: number;
}

/** Past this many tokens on either side, a line is not worth comparing word by word. */
export const MAX_INTRALINE_TOKENS = 300;

const TOKEN = /\w+|\s+|[^\w\s]/g;

function tokenize(text: string): Token[] {
	return [...text.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index ?? 0 }));
}

/** Changed tokens as character ranges, neighbours merged into one run. */
function toRanges(listTokens: Token[], listChanged: boolean[]): CharRange[] {
	const listRanges: CharRange[] = [];
	listTokens.forEach((token, index) => {
		if (!listChanged[index]) return;
		const end = token.start + token.text.length;
		const last = listRanges[listRanges.length - 1];
		if (last && last.end === token.start) last.end = end;
		else listRanges.push({ start: token.start, end });
	});
	return listRanges;
}

/**
 * The parts of a deleted line and the added line that replaced it which actually differ.
 *
 * Words, runs of whitespace and single punctuation marks are compared as tokens: the common
 * prefix and suffix are stripped, and the middles matched by longest common subsequence. Two lines
 * that share less than half the shorter one's tokens are a rewrite, not an edit — marking nearly all of both
 * says nothing the row colours do not, so nothing is marked.
 */
export function intralineRanges(
	oldText: string,
	newText: string
): { listOld: CharRange[]; listNew: CharRange[] } {
	const none = { listOld: [], listNew: [] };
	if (oldText === newText) return none;
	const listOld = tokenize(oldText);
	const listNew = tokenize(newText);
	if (listOld.length > MAX_INTRALINE_TOKENS || listNew.length > MAX_INTRALINE_TOKENS) return none;

	let prefix = 0;
	while (
		prefix < listOld.length &&
		prefix < listNew.length &&
		listOld[prefix].text === listNew[prefix].text
	) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < listOld.length - prefix &&
		suffix < listNew.length - prefix &&
		listOld[listOld.length - 1 - suffix].text === listNew[listNew.length - 1 - suffix].text
	) {
		suffix++;
	}

	const listOldMid = listOld.slice(prefix, listOld.length - suffix);
	const listNewMid = listNew.slice(prefix, listNew.length - suffix);
	const rows = listOldMid.length;
	const cols = listNewMid.length;
	// lcs[i][j]: longest common subsequence of the middles from i and j onwards.
	const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
		new Array<number>(cols + 1).fill(0)
	);
	for (let i = rows - 1; i >= 0; i--) {
		for (let j = cols - 1; j >= 0; j--) {
			lcs[i][j] =
				listOldMid[i].text === listNewMid[j].text
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const listOldChanged = listOld.map(() => false);
	const listNewChanged = listNew.map(() => false);
	let i = 0;
	let j = 0;
	while (i < rows || j < cols) {
		if (i < rows && j < cols && listOldMid[i].text === listNewMid[j].text) {
			i++;
			j++;
		} else if (j >= cols || (i < rows && lcs[i + 1][j] >= lcs[i][j + 1])) {
			listOldChanged[prefix + i++] = true;
		} else {
			listNewChanged[prefix + j++] = true;
		}
	}

	const shared = prefix + suffix + lcs[0][0];
	// Measured against the shorter line, so text appended to or cut from a line still reads as an
	// edit of it, while two unrelated lines are left to their row colours.
	if (shared * 2 < Math.min(listOld.length, listNew.length)) return none;
	return { listOld: toRanges(listOld, listOldChanged), listNew: toRanges(listNew, listNewChanged) };
}

/**
 * The line's tokens cut at every range edge, the slices inside a range marked `emph`. Without
 * syntax tokens the plain text stands in as one token. The text itself is untouched, so the row
 * keeps its height.
 */
export function applyRanges(
	listTokens: HighlightToken[] | null | undefined,
	text: string,
	listRanges: CharRange[]
): HighlightToken[] {
	const listSource: HighlightToken[] = listTokens ?? [{ content: text }];
	if (listRanges.length === 0) return listSource;
	const listResult: HighlightToken[] = [];
	let offset = 0;
	for (const token of listSource) {
		const tokenEnd = offset + token.content.length;
		let cursor = offset;
		for (const range of listRanges) {
			if (range.end <= cursor || range.start >= tokenEnd) continue;
			const from = Math.max(range.start, cursor);
			const to = Math.min(range.end, tokenEnd);
			if (from > cursor) {
				listResult.push({ ...token, content: token.content.slice(cursor - offset, from - offset) });
			}
			listResult.push({
				...token,
				content: token.content.slice(from - offset, to - offset),
				emph: true,
			});
			cursor = to;
		}
		if (cursor < tokenEnd)
			listResult.push({ ...token, content: token.content.slice(cursor - offset) });
		offset = tokenEnd;
	}
	return listResult;
}
