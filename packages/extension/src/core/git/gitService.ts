import type {
	Commit,
	CommitDetails,
	FileChange,
	FileStatus,
	WorkingTreeStatus,
} from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';
import { LOG_FORMAT, parseLog } from './logParser.js';
import { STATUS_ARGS, parseStatus } from './statusParser.js';

export interface GraphFilterOptions {
	branch: string | null;
	showRemoteBranches: boolean;
}

/** Which refs `git log` should walk for the current filters. */
function refArgs(filters: GraphFilterOptions): string[] {
	if (filters.branch) return [filters.branch];
	return filters.showRemoteBranches ? ['--all'] : ['--branches', '--tags', 'HEAD'];
}

/** Load up to `limit` commits for the current filters, in graph (date) order. */
export async function getCommits(
	executor: GitExecutor,
	cwd: string,
	limit: number,
	filters: GraphFilterOptions
): Promise<Commit[]> {
	const output = await executor.run(
		[
			'log',
			`--pretty=format:${LOG_FORMAT}`,
			...refArgs(filters),
			'--date-order',
			'-n',
			String(limit),
		],
		cwd
	);
	return parseLog(output);
}

/** Branch names for the Branches dropdown: local branches first, then remote-tracking ones. */
export async function getBranches(executor: GitExecutor, cwd: string): Promise<string[]> {
	try {
		const output = await executor.run(
			['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
			cwd
		);
		return output
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '' && !line.endsWith('/HEAD'));
	} catch {
		return [];
	}
}

/** The checked-out branch name, or null when HEAD is detached. */
export async function getCurrentBranch(
	executor: GitExecutor,
	cwd: string
): Promise<string | null> {
	try {
		const name = (await executor.run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
		return name === '' || name === 'HEAD' ? null : name;
	} catch {
		return null;
	}
}

/** Read the working tree status (staged & unstaged changes). */
export async function getStatus(executor: GitExecutor, cwd: string): Promise<WorkingTreeStatus> {
	return parseStatus(await executor.run(STATUS_ARGS, cwd));
}

/** Resolve the current HEAD commit hash, or null in an empty repository. */
export async function getHeadHash(executor: GitExecutor, cwd: string): Promise<string | null> {
	try {
		return (await executor.run(['rev-parse', 'HEAD'], cwd)).trim() || null;
	} catch {
		return null;
	}
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
