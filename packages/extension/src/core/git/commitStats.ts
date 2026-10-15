import type { CommitStat } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

const HASH = /^[0-9a-f]{7,64}$/;

/**
 * Read a `--shortstat` line — ` 2 files changed, 27 insertions(+), 11 deletions(-)` — where either
 * count is left out when it is zero. No line at all (an empty commit) reads as nothing changed.
 */
export function parseShortstat(text: string): Omit<CommitStat, 'hash'> {
	const count = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? 0);
	return {
		files: count(/(\d+) files? changed/),
		insertions: count(/(\d+) insertions?\(\+\)/),
		deletions: count(/(\d+) deletions?\(-\)/),
	};
}

export function commitStatsLogArgs(listHashes: string[]): string[] {
	// `unsorted` keeps git from walking or reordering; the records are matched by hash anyway.
	return ['log', '--no-walk=unsorted', '--format=%x00%H%x00%P', '--shortstat', ...listHashes];
}

/** Each record of {@link commitStatsLogArgs}' output: the hash, its parents and its stat. */
export function parseCommitStatsLog(
	output: string
): { hash: string; listParents: string[]; stat: Omit<CommitStat, 'hash'> }[] {
	return output
		.split('\0')
		.slice(1)
		.reduce<string[][]>((listRecords, field, index) => {
			if (index % 2 === 0) listRecords.push([field]);
			else listRecords[listRecords.length - 1].push(field);
			return listRecords;
		}, [])
		.map(([hash, rest = '']) => {
			const newline = rest.indexOf('\n');
			const parents = newline === -1 ? rest : rest.slice(0, newline);
			return {
				hash: hash.trim(),
				listParents: parents.split(' ').filter((parent) => parent !== ''),
				stat: parseShortstat(newline === -1 ? '' : rest.slice(newline)),
			};
		});
}

/**
 * The size of each commit asked about. `git log` gives a merge no diff, so a merge is measured on
 * its own against its first parent — what it brought into the branch it was merged into.
 */
export async function getCommitStats(
	executor: GitExecutor,
	cwd: string,
	listHashes: string[]
): Promise<CommitStat[]> {
	const listAsked = [...new Set(listHashes.filter((hash) => HASH.test(hash)))];
	if (listAsked.length === 0) return [];
	const listRecords = parseCommitStatsLog(await executor.run(commitStatsLogArgs(listAsked), cwd));
	return Promise.all(
		listRecords.map(async (record): Promise<CommitStat> => {
			if (record.listParents.length < 2) return { hash: record.hash, ...record.stat };
			const stat = await executor.run(
				['diff-tree', '-r', '--shortstat', record.listParents[0], record.hash],
				cwd
			);
			return { hash: record.hash, ...parseShortstat(stat) };
		})
	);
}
