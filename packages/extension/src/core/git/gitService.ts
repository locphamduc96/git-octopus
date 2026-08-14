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
import { parseNumstat } from './numstatParser.js';

export interface GraphFilterOptions {
	branch: string | null;
	showRemoteBranches: boolean;
}

/** Which refs `git log` should walk for the current filters. */
function refArgs(filters: GraphFilterOptions): string[] {
	if (filters.branch) return [filters.branch];
	return filters.showRemoteBranches ? ['--all'] : ['--branches', '--tags', 'HEAD'];
}

/**
 * Load up to `limit` commits for the current filters, in graph (date) order.
 * `listExtraRevs` adds revisions not reachable from refs (used for stash commits).
 */
export async function getCommits(
	executor: GitExecutor,
	cwd: string,
	limit: number,
	filters: GraphFilterOptions,
	listExtraRevs: string[] = []
): Promise<Commit[]> {
	const output = await executor.run(
		[
			'log',
			// Full ref paths so a local `feature/x` is never mistaken for a remote branch.
			'--decorate=full',
			`--pretty=format:${LOG_FORMAT}`,
			...refArgs(filters),
			...listExtraRevs,
			'--date-order',
			'-n',
			String(limit),
		],
		cwd
	);
	return parseLog(output);
}

export interface StashEntry {
	hash: string;
	/** Stash selector, e.g. "stash@{0}". */
	name: string;
}

/** List the repository's stashes, newest first. */
export async function getStashes(executor: GitExecutor, cwd: string): Promise<StashEntry[]> {
	try {
		// %gd is the short selector ("stash@{0}"); %gD would give the full "refs/stash@{0}".
		const output = await executor.run(['stash', 'list', '--pretty=format:%H%x00%gd'], cwd);
		return output
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => {
				const [hash, name] = line.split('\0');
				return { hash, name };
			});
	} catch {
		return [];
	}
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

export interface AheadBehind {
	ahead: number;
	behind: number;
}

/** How far the current branch is ahead of / behind its upstream (zeroes when no upstream). */
export async function getAheadBehind(
	executor: GitExecutor,
	cwd: string
): Promise<AheadBehind> {
	try {
		const output = await executor.run(
			['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
			cwd
		);
		const [behind, ahead] = output.trim().split(/\s+/).map(Number);
		return { ahead: ahead || 0, behind: behind || 0 };
	} catch {
		return { ahead: 0, behind: 0 };
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

/** Metadata for a single commit; the body comes last so it may contain anything. */
const DETAIL_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B';

/** Load metadata, the full message and the changed files (with line counts) for one commit. */
export async function getCommitDetails(
	executor: GitExecutor,
	cwd: string,
	hash: string
): Promise<CommitDetails> {
	const [meta, nameStatus, numstat] = await Promise.all([
		executor.run(['show', '-s', `--format=${DETAIL_FORMAT}`, hash], cwd),
		executor.run(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash], cwd),
		executor.run(['diff-tree', '--no-commit-id', '--numstat', '-r', '--root', hash], cwd),
	]);

	const [fullHash, parents, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, ...bodyParts] =
		meta.split('\0');
	const mapCounts = parseNumstat(numstat);
	const files = parseNameStatus(nameStatus).map((file) => ({
		...file,
		...mapCounts.get(file.path),
	}));

	return {
		hash: fullHash ?? hash,
		parents: parents ? parents.split(' ').filter((parent) => parent !== '') : [],
		author: { name: authorName ?? '', email: authorEmail ?? '' },
		authoredAt: Number.parseInt(authoredAt ?? '0', 10) || 0,
		committer: { name: committerName ?? '', email: committerEmail ?? '' },
		committedAt: Number.parseInt(committedAt ?? '0', 10) || 0,
		body: bodyParts.join('\0').replace(/\n+$/, ''),
		files,
	};
}

/** Files that differ between two commits. */
export async function getComparison(
	executor: GitExecutor,
	cwd: string,
	fromHash: string,
	toHash: string
): Promise<FileChange[]> {
	const output = await executor.run(['diff', '--name-status', '-r', fromHash, toHash], cwd);
	return parseNameStatus(output);
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
