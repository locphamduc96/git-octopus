import type { Commit, CommitDetails, FileChange, FileStatus } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';
import { LOG_FORMAT, parseLog } from './logParser.js';

/** Load up to `limit` commits across all refs, in graph (date) order. */
export async function getCommits(
	executor: GitExecutor,
	cwd: string,
	limit: number
): Promise<Commit[]> {
	const output = await executor.run(
		['log', `--pretty=format:${LOG_FORMAT}`, '--all', '--date-order', '-n', String(limit)],
		cwd
	);
	return parseLog(output);
}

/** Load the full message body and changed files for a single commit. */
export async function getCommitDetails(
	executor: GitExecutor,
	cwd: string,
	hash: string
): Promise<CommitDetails> {
	const [body, nameStatus] = await Promise.all([
		executor.run(['show', '-s', '--format=%B', hash], cwd),
		executor.run(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash], cwd),
	]);
	return { hash, body: body.replace(/\n+$/, ''), files: parseNameStatus(nameStatus) };
}

/** Return the content of `path` at revision `rev`, or '' if it does not exist there. */
export async function getFileAtRev(
	executor: GitExecutor,
	cwd: string,
	rev: string,
	path: string
): Promise<string> {
	try {
		return await executor.run(['show', `${rev}:${path}`], cwd);
	} catch {
		return '';
	}
}

function parseNameStatus(output: string): FileChange[] {
	const listFiles: FileChange[] = [];
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const parts = line.split('\t');
		const status = (parts[0]?.[0] ?? 'X') as FileStatus;
		if ((status === 'R' || status === 'C') && parts.length >= 3) {
			listFiles.push({ status, oldPath: parts[1], path: parts[2] });
		} else if (parts[1]) {
			listFiles.push({ status, path: parts[1] });
		}
	}
	return listFiles;
}
