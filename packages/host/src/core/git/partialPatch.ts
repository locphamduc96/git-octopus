import type { SelectedDiffLine } from '@git-octopus/shared';

/**
 * Which way the patch will be applied. `forward` takes the selected changes from the diff into its
 * old side (staging from an index → working-tree diff). `reverse` takes them back out of its new
 * side (unstaging from a HEAD → index diff, discarding from an index → working-tree diff).
 */
export type PatchDirection = 'forward' | 'reverse';

export type PartialPatch = { patch: string } | { error: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/**
 * A patch holding only the selected lines of a one-file unified diff, ready for `git apply`.
 *
 * The rule for what is left out depends on the direction, because the side the patch is applied to
 * must stay exactly as it is wherever nothing was selected:
 * - forward: an unselected `+` is not there yet, so it is dropped; an unselected `-` is still there,
 *   so it becomes context.
 * - reverse: an unselected `+` is there and stays, so it becomes context; an unselected `-` is
 *   already gone, so it is dropped.
 *
 * Every selected line is matched by its line number **and** its text. The diff is read again at the
 * moment of applying, so a file that changed after the view drew it shows up as a line that no longer
 * matches — and the whole request is refused rather than applied to the wrong lines.
 *
 * A `\ No newline at end of file` marker travels with the line before it: kept when that line is
 * kept (as a change or as context), dropped with it otherwise.
 */
export function buildPartialPatch(
	rawDiff: string,
	listSelected: SelectedDiffLine[],
	direction: PatchDirection
): PartialPatch {
	if (listSelected.length === 0) return { error: 'No lines are selected.' };
	const mapWanted = new Map<string, string>();
	for (const line of listSelected) {
		mapWanted.set(line.kind === 'add' ? `a:${line.newLine}` : `d:${line.oldLine}`, line.text);
	}

	const listRaw = rawDiff.split('\n');
	if (listRaw[listRaw.length - 1] === '') listRaw.pop();
	const firstHunk = listRaw.findIndex((line) => line.startsWith('@@'));
	if (firstHunk === -1) return { error: 'There is no change in this file to apply.' };
	const listHeader = listRaw.slice(0, firstHunk);

	const listOut: string[] = [...listHeader];
	const setMatched = new Set<string>();
	let index = firstHunk;
	while (index < listRaw.length) {
		const header = HUNK_HEADER.exec(listRaw[index]);
		if (!header) return { error: 'The diff could not be read.' };
		let oldLine = Number(header[1]);
		let newLine = Number(header[2]);
		const oldStart = oldLine;
		const newStart = newLine;
		index++;

		const listBody: string[] = [];
		let selectedHere = false;
		let keptPrevious = true;
		let oldCount = 0;
		let newCount = 0;
		const keep = (line: string, countsOld: boolean, countsNew: boolean): void => {
			listBody.push(line);
			if (countsOld) oldCount++;
			if (countsNew) newCount++;
			keptPrevious = true;
		};
		while (index < listRaw.length && !listRaw[index].startsWith('@@')) {
			const line = listRaw[index];
			const text = line.slice(1);
			if (line.startsWith('\\')) {
				if (keptPrevious) listBody.push(line);
			} else if (line.startsWith('+')) {
				const key = `a:${newLine}`;
				const selected = mapWanted.get(key) === text;
				if (selected) {
					setMatched.add(key);
					selectedHere = true;
					keep(line, false, true);
				} else if (direction === 'reverse') keep(` ${text}`, true, true);
				else keptPrevious = false;
				newLine++;
			} else if (line.startsWith('-')) {
				const key = `d:${oldLine}`;
				const selected = mapWanted.get(key) === text;
				if (selected) {
					setMatched.add(key);
					selectedHere = true;
					keep(line, true, false);
				} else if (direction === 'forward') keep(` ${text}`, true, true);
				else keptPrevious = false;
				oldLine++;
			} else {
				keep(line.startsWith(' ') ? line : ` ${line}`, true, true);
				oldLine++;
				newLine++;
			}
			index++;
		}
		if (!selectedHere) continue;
		listOut.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${header[3]}`);
		listOut.push(...listBody);
	}

	if (setMatched.size !== mapWanted.size) {
		return {
			error: 'The file changed after the diff was drawn — look again and pick the lines anew.',
		};
	}
	return { patch: `${listOut.join('\n')}\n` };
}
