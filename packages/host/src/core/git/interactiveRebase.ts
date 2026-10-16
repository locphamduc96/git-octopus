import type { RebaseStep, RebaseTodoCommit } from '@git-octopus/shared';

export { validateSteps } from '@git-octopus/shared';

/** `it's` → `'it'\''s'`: one argument to sh, whatever the text holds. */
export function shellQuote(text: string): string {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * A message as a `printf` format that prints it back exactly: `\` and `%` are what `printf` would
 * otherwise interpret, and a newline becomes `\n` so the whole message fits on one todo line.
 */
export function printfFormat(message: string): string {
	const format = message.replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/\n/g, '\\n');
	// A leading `-` would be read as an option by bash's printf; `\055` is the same character.
	return format.startsWith('-') ? `\\055${format.slice(1)}` : format;
}

/**
 * The todo git runs, line by line, in the order given.
 *
 * Every commit is named, a dropped one as `drop`, so `rebase.missingCommitsCheck` has nothing to
 * complain about. A reword is a `pick` followed by an `exec` that amends the message from a `printf`
 * of it — no editor and no file, so a rebase that pauses on a conflict and is continued later still
 * has everything its remaining lines need. Hooks are skipped on that amend: they would run against a
 * historical tree mid-rebase.
 */
export function buildTodo(listSteps: RebaseStep[]): string {
	const listLines: string[] = [];
	for (const step of listSteps) {
		if (step.action === 'reword') {
			listLines.push(`pick ${step.hash}`);
			const message = (step.message ?? '').replace(/\s+$/, '');
			listLines.push(
				`exec printf ${shellQuote(printfFormat(message))} | git commit --amend --only --allow-empty --no-verify -F -`
			);
			continue;
		}
		listLines.push(`${step.action} ${step.hash}`);
	}
	return `${listLines.join('\n')}\n`;
}

const RECORD = '\x1e';
const UNIT = '\x1f';

/** `git log` arguments for the editor's list: oldest first, full messages. */
export function rebaseTodoLogArgs(base: string, tip = 'HEAD'): string[] {
	return ['log', '--reverse', `--format=${RECORD}%H${UNIT}%an${UNIT}%B`, `${base}..${tip}`];
}

export function parseRebaseTodoLog(output: string): RebaseTodoCommit[] {
	return output
		.split(RECORD)
		.filter((record) => record.trim() !== '')
		.map((record) => {
			const [hash, author, ...listMessage] = record.split(UNIT);
			const message = listMessage.join(UNIT).replace(/\s+$/, '');
			return { hash: hash.trim(), author, message, subject: message.split('\n')[0] ?? '' };
		});
}
