import type { DiffHunk, DiffLine } from '@git-octopus/shared';

/** Matches a hunk header: `@@ -12,7 +12,9 @@ optional section heading`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse `git diff` unified output into hunks, keeping both line numbers per line.
 *
 * Only the hunks are kept: the `diff --git` preamble says nothing the caller does not already
 * know, since a diff is always requested one path at a time. Everything before the first `@@` is
 * skipped, which also drops the `index`/`similarity` lines and any rename headers.
 */
export function parseUnifiedDiff(output: string): DiffHunk[] {
	const listHunks: DiffHunk[] = [];
	let hunk: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	for (const raw of output.split('\n')) {
		const header = HUNK_HEADER.exec(raw);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[3]);
			hunk = {
				oldStart: oldLine,
				newStart: newLine,
				heading: header[5].trim(),
				listLines: [],
			};
			listHunks.push(hunk);
			continue;
		}
		if (!hunk) continue;

		// A trailing empty string from the final newline is not a context line.
		if (raw === '') continue;
		// Git's note that a side has no final newline belongs to the line above, not to the diff.
		if (raw.startsWith('\\')) continue;

		const marker = raw[0];
		const text = raw.slice(1);
		if (marker === '+') {
			hunk.listLines.push({ kind: 'add', text, oldLine: null, newLine: newLine++ });
		} else if (marker === '-') {
			hunk.listLines.push({ kind: 'del', text, oldLine: oldLine++, newLine: null });
		} else if (marker === ' ') {
			hunk.listLines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
		}
		// Anything else is a new file's header block (`diff --git`, `index`, `+++`), which only
		// appears between hunks when a caller diffs several paths at once. Ignored on purpose.
	}
	return listHunks;
}

/** Whether git refused to diff the file because it is binary. */
export function isBinaryDiff(output: string): boolean {
	return /^Binary files /m.test(output) || /^GIT binary patch$/m.test(output);
}

/** Total lines the hunks would draw, context included — what a size cap has to budget for. */
export function countDiffLines(listHunks: DiffHunk[]): number {
	let total = 0;
	for (const hunk of listHunks) total += hunk.listLines.length;
	return total;
}

export type { DiffHunk, DiffLine };
