import type { FileHistoryEntry, FileStatus } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

/** How many commits one history read returns; one more is asked for to know whether there are more. */
export const FILE_HISTORY_LIMIT = 500;

const RECORD = '\x1e';
const UNIT = '\x1f';

/**
 * `git log --follow` for one path, one record per commit: a header line, then the commit's
 * name-status line for the file.
 *
 * `--follow` is what carries the history across a rename — and it only works for a single path,
 * which is all this is for. `core.quotePath=false` keeps a non-ASCII name literal instead of
 * C-quoted, so the name shown is the name on disk.
 */
export function fileHistoryArgs(path: string, rev?: string): string[] {
	return [
		'-c',
		'core.quotePath=false',
		'log',
		'--follow',
		`--max-count=${String(FILE_HISTORY_LIMIT + 1)}`,
		'--name-status',
		`--format=${RECORD}%H${UNIT}%an${UNIT}%ae${UNIT}%at${UNIT}%s`,
		...(rev ? [rev] : []),
		'--',
		path,
	];
}

/**
 * Parse `fileHistoryArgs` output. A commit with no name-status line for the file — a merge, which
 * `log` shows without a diff — is left out: it changed nothing about this file on its own.
 */
export function parseFileHistory(output: string): FileHistoryEntry[] {
	const listEntries: FileHistoryEntry[] = [];
	for (const record of output.split(RECORD)) {
		if (record.trim() === '') continue;
		const [header, ...listRest] = record.split('\n');
		const [hash, name, email, at, ...listSubject] = header.split(UNIT);
		const change = listRest.find((line) => /^[A-Z]\d*\t/.test(line));
		if (!hash || !change) continue;
		const [code, ...listPaths] = change.split('\t');
		const status = code[0] as FileStatus;
		const entry: FileHistoryEntry = {
			hash,
			subject: listSubject.join(UNIT),
			author: { name: name ?? '', email: email ?? '' },
			authoredAt: Number.parseInt(at ?? '0', 10) || 0,
			status,
			path: listPaths[listPaths.length - 1] ?? '',
		};
		if ((status === 'R' || status === 'C') && listPaths.length === 2) entry.oldPath = listPaths[0];
		listEntries.push(entry);
	}
	return listEntries;
}

export async function getFileHistory(
	executor: GitExecutor,
	cwd: string,
	path: string,
	rev?: string
): Promise<{ listEntries: FileHistoryEntry[]; truncated: boolean }> {
	const listEntries = parseFileHistory(await executor.run(fileHistoryArgs(path, rev), cwd));
	return {
		listEntries: listEntries.slice(0, FILE_HISTORY_LIMIT),
		truncated: listEntries.length > FILE_HISTORY_LIMIT,
	};
}
