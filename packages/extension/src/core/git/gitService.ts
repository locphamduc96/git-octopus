import type {
	Commit,
	CommitDetails,
	DiffHunk,
	FileChange,
	FileStatus,
	WorkingTreeStatus,
} from '@git-octopus/shared';
import { isBinaryDiff, parseUnifiedDiff } from './diffParser.js';
import type { GitExecutor } from './GitExecutor.js';
import { LOG_FORMAT, parseLog } from './logParser.js';
import { STATUS_ARGS, parseStatus } from './statusParser.js';
import { parseNumstat } from './numstatParser.js';

export interface GraphFilterOptions {
	branch: string | null;
	showRemoteBranches: boolean;
	commitOrder?: 'date' | 'authorDate' | 'topo';
	showTags?: boolean;
}

/** Which refs `git log` should walk for the current filters. */
function refArgs(filters: GraphFilterOptions): string[] {
	if (filters.branch) return [filters.branch];
	const listRefs = ['--branches', 'HEAD'];
	if (filters.showRemoteBranches) listRefs.push('--remotes');
	if (filters.showTags ?? true) listRefs.push('--tags');
	return listRefs;
}

const mapOrderArg = {
	date: '--date-order',
	authorDate: '--author-date-order',
	topo: '--topo-order',
} as const;

/**
 * Load up to `limit` commits for the current filters, in graph (date) order.
 * `listExtraRevs` adds revisions not reachable from refs (used for stash commits).
 */
export async function getCommits(
	executor: GitExecutor,
	cwd: string,
	limit: number,
	filters: GraphFilterOptions,
	listExtraRevs: string[] = [],
	/** Configured remote names — the only thing that can say where a remote's name ends. */
	listRemotes: string[] = []
): Promise<Commit[]> {
	const output = await executor.run(
		[
			'log',
			// Full ref paths so a local `feature/x` is never mistaken for a remote branch.
			'--decorate=full',
			`--pretty=format:${LOG_FORMAT}`,
			...refArgs(filters),
			...listExtraRevs,
			mapOrderArg[filters.commitOrder ?? 'date'],
			'-n',
			String(limit),
		],
		cwd
	);
	return parseLog(output, listRemotes);
}

export interface StashEntry {
	hash: string;
	/** Stash selector, e.g. "stash@{0}". */
	name: string;
	/** The stash's subject line, e.g. "WIP on main: 1234abc …". */
	message: string;
}

/** List the repository's stashes, newest first. */
export async function getStashes(executor: GitExecutor, cwd: string): Promise<StashEntry[]> {
	try {
		// %gd is the short selector ("stash@{0}"); %gD would give the full "refs/stash@{0}".
		const output = await executor.run(['stash', 'list', '--pretty=format:%H%x00%gd%x00%gs'], cwd);
		return output
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => {
				const [hash, name, message] = line.split('\0');
				return { hash, name, message: message ?? '' };
			});
	} catch {
		return [];
	}
}

export interface BranchEntry {
	/** Short name — "feature/x" for locals, "origin/feature/x" for remote-tracking refs. */
	name: string;
	hash: string;
	/** True for the checked-out branch. */
	current: boolean;
}

/** Branches under one ref namespace ("refs/heads" or "refs/remotes/<name>"), with their tips. */
export async function getBranchEntries(
	executor: GitExecutor,
	cwd: string,
	refNamespace: string
): Promise<BranchEntry[]> {
	try {
		// Full hashes: the webview matches them against `git log --pretty=%H` output, so a short
		// hash would select the commit but never scroll to it.
		const output = await executor.run(
			[
				'for-each-ref',
				'--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(symref)',
				refNamespace,
			],
			cwd
		);
		return (
			output
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => {
					const [name, hash, head, symref] = line.split('\0');
					return { name, hash: hash ?? '', current: head === '*', symref: symref ?? '' };
				})
				// Symbolic refs are pointers, not branches — origin/HEAD shortens to a bare "origin",
				// which downstream prefix-stripping would turn into an empty label.
				.filter((entry) => entry.name !== '' && entry.symref === '')
				.map(({ name, hash, current }) => ({ name, hash, current }))
		);
	} catch {
		return [];
	}
}

export interface TagEntry {
	name: string;
	/** The tagged commit — annotated tags are dereferenced past the tag object. */
	hash: string;
}

/** All tags, newest first. */
export async function getTags(executor: GitExecutor, cwd: string): Promise<TagEntry[]> {
	try {
		const output = await executor.run(
			[
				'for-each-ref',
				'refs/tags',
				'--sort=-creatordate',
				'--format=%(refname:short)%00%(objectname)%00%(*objectname)',
			],
			cwd
		);
		return output
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => {
				const [name, hash, dereferenced] = line.split('\0');
				return { name, hash: dereferenced || hash || '' };
			});
	} catch {
		return [];
	}
}

/** Configured remote names, e.g. ["origin", "upstream"]. */
export async function getRemoteNames(executor: GitExecutor, cwd: string): Promise<string[]> {
	try {
		return (await executor.run(['remote'], cwd))
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '');
	} catch {
		return [];
	}
}

export interface SubmoduleEntry {
	path: string;
	hash: string;
}

/**
 * Parse `git submodule status` output. Each line is `<state?><sha1> <path> (<describe>)`, where
 * the state prefix is one of space, `+`, `-`, `U`.
 */
export function parseSubmoduleStatus(output: string): SubmoduleEntry[] {
	const listSubmodules: SubmoduleEntry[] = [];
	for (const line of output.split('\n')) {
		const match = /^[ +\-U]?([0-9a-f]{40})\s+(\S+)/.exec(line);
		if (match) listSubmodules.push({ hash: match[1].slice(0, 8), path: match[2] });
	}
	return listSubmodules;
}

export async function getSubmodules(executor: GitExecutor, cwd: string): Promise<SubmoduleEntry[]> {
	try {
		return parseSubmoduleStatus(await executor.run(['submodule', 'status'], cwd));
	} catch {
		return [];
	}
}

/** The checked-out branch name, or null when HEAD is detached. */
export async function getCurrentBranch(executor: GitExecutor, cwd: string): Promise<string | null> {
	try {
		const name = (await executor.run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
		return name === '' || name === 'HEAD' ? null : name;
	} catch {
		return null;
	}
}

/**
 * The branch HEAD was on before the last checkout — what `git checkout -` would return to.
 *
 * `@{-1}` reads the reflog, so it is empty in a fresh clone and resolves to a hash rather than a
 * name when the previous position was itself detached. Both are "no branch to offer", not errors.
 */
export async function getPreviousBranch(
	executor: GitExecutor,
	cwd: string
): Promise<string | null> {
	try {
		const name = (await executor.run(['rev-parse', '--abbrev-ref', '@{-1}'], cwd)).trim();
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
export async function getAheadBehind(executor: GitExecutor, cwd: string): Promise<AheadBehind> {
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

/**
 * Which multi-step operation is paused in this repository, if any.
 *
 * Detected the way git itself does (wt-status): a rebase is the `rebase-merge`/`rebase-apply`
 * directory, the others are their sequencer head files. REBASE_HEAD is deliberately NOT used —
 * git can leave that file behind after a rebase has finished, so it reports rebases that no
 * longer exist. A rebase paused on a conflict also writes CHERRY_PICK_HEAD (it replays with the
 * cherry-pick machinery), so the rebase directories are checked first.
 *
 * `exists` is injected so this stays a pure description of git's on-disk state machine.
 */
export async function getRepoState(
	executor: GitExecutor,
	cwd: string,
	exists: (path: string) => Promise<boolean>
): Promise<'rebasing' | 'merging' | 'cherryPicking' | 'reverting' | null> {
	let gitDir: string;
	try {
		gitDir = (await executor.run(['rev-parse', '--absolute-git-dir'], cwd)).trim();
	} catch {
		return null;
	}
	if (gitDir === '') return null;
	const listChecks: ['rebasing' | 'merging' | 'cherryPicking' | 'reverting', string][] = [
		['rebasing', 'rebase-merge'],
		['rebasing', 'rebase-apply'],
		['merging', 'MERGE_HEAD'],
		['cherryPicking', 'CHERRY_PICK_HEAD'],
		['reverting', 'REVERT_HEAD'],
	];
	for (const [state, name] of listChecks) {
		if (await exists(`${gitDir}/${name}`)) return state;
	}
	return null;
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

	const [
		fullHash,
		parents,
		authorName,
		authorEmail,
		authoredAt,
		committerName,
		committerEmail,
		committedAt,
		...bodyParts
	] = meta.split('\0');
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

/** What a diff is being taken of: one commit, a range of two, or the working tree. */
export interface FileDiffRequest {
	path: string;
	/** The path before a rename; the diff then covers old → new instead of a whole-file add. */
	oldPath?: string;
	/** A commit, diffed against its first parent. */
	hash?: string;
	/** A range; both must be given together. */
	fromHash?: string;
	toHash?: string;
	/** A working-tree file git does not track yet — diffed against an empty file. */
	untracked?: boolean;
	/** Context lines around each change. The whole-file view asks for more than any file has. */
	context: number;
}

export interface FileDiffResult {
	listHunks: DiffHunk[];
	/** Set when there is nothing to draw, and says why. */
	notice?: string;
}

function diffArgs(request: FileDiffRequest): string[] {
	const context = `-U${String(request.context)}`;
	// A rename needs both paths in the pathspec and rename detection on, or git reports the new
	// path as a whole-file add.
	const listPaths = request.oldPath ? [request.oldPath, request.path] : [request.path];
	const rename = request.oldPath ? ['-M'] : [];
	if (request.untracked) {
		// An untracked file has no side to compare against, so git has to be told to diff two paths
		// rather than two revisions. `--no-index` exits 1 whenever the files differ — that is the
		// expected case here, not an error, so `getFileDiff` whitelists it.
		return ['diff', '--no-index', context, '--', '/dev/null', request.path];
	}
	if (request.fromHash && request.toHash) {
		return ['diff', ...rename, context, request.fromHash, request.toHash, '--', ...listPaths];
	}
	if (request.hash) {
		// `--root` so the first commit in history diffs against the empty tree instead of nothing.
		return [
			'diff-tree',
			'-p',
			'-r',
			...rename,
			'--root',
			'--no-commit-id',
			context,
			request.hash,
			'--',
			...listPaths,
		];
	}
	return ['diff', 'HEAD', ...rename, context, '--', ...listPaths];
}

/** The hash of git's empty tree — what HEAD effectively is before the first commit exists. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Raw diff output above this is rejected before parsing — see the guard in `getFileDiff`. */
const MAX_DIFF_BYTES = 10 * 1024 * 1024;

/** Read one file's diff as hunks. Never throws: a diff that cannot be drawn comes back as a notice. */
export async function getFileDiff(
	executor: GitExecutor,
	cwd: string,
	request: FileDiffRequest
): Promise<FileDiffResult> {
	let output: string | null;
	try {
		output = await executor.run(diffArgs(request), cwd, request.untracked ? [1] : undefined);
	} catch {
		// The working-tree diff runs against HEAD, which an empty repository does not have yet —
		// but a staged file there still deserves its diff, taken against the empty tree instead.
		// Only on an actual failure: an empty output just means the file is unchanged.
		output =
			!request.hash && !request.fromHash && !request.untracked
				? await tryRun(
						executor,
						['diff', EMPTY_TREE, `-U${String(request.context)}`, '--', request.path],
						cwd
					)
				: null;
	}
	if (output === null) return { listHunks: [], notice: 'This file has no diff to show.' };
	// Checked on the raw text, before any parsing: past this size the parse itself is the hang,
	// so the line-count limit downstream would come too late.
	if (output.length > MAX_DIFF_BYTES) {
		return {
			listHunks: [],
			notice:
				'This diff is larger than 10 MB — too large to draw here. Open it in the editor instead.',
		};
	}
	if (isBinaryDiff(output)) {
		return { listHunks: [], notice: 'Binary file — open it in the editor to view it.' };
	}
	const listHunks = parseUnifiedDiff(output);
	if (listHunks.length === 0) {
		return { listHunks: [], notice: 'No changes in this file.' };
	}
	return { listHunks };
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

export interface RepoIdentity {
	/** Effective values (local override when present, otherwise inherited), null when unset. */
	name: string | null;
	email: string | null;
	hasLocalName: boolean;
	hasLocalEmail: boolean;
	listRemoteUrls: string[];
	/**
	 * The global config's identity, whether or not the repository overrides it. Reported alongside
	 * the effective one so the view can always offer the way back: an override is only reversible if
	 * you can see what it is hiding.
	 */
	globalName: string | null;
	globalEmail: string | null;
}

/** `git config --get` exits non-zero when a key is unset — that is "no value", not an error. */
async function tryRun(
	executor: GitExecutor,
	args: string[],
	cwd: string,
	listOkCodes?: number[]
): Promise<string | null> {
	try {
		const output = await executor.run(args, cwd, listOkCodes);
		const trimmed = output.trim();
		return trimmed === '' ? null : trimmed;
	} catch {
		return null;
	}
}

/** Read the repository's effective Git identity, its local overrides, and its remote URLs. */
export async function getRepoIdentity(executor: GitExecutor, cwd: string): Promise<RepoIdentity> {
	const [name, email, localName, localEmail, globalName, globalEmail, remotes] = await Promise.all([
		tryRun(executor, ['config', '--get', 'user.name'], cwd),
		tryRun(executor, ['config', '--get', 'user.email'], cwd),
		tryRun(executor, ['config', '--local', '--get', 'user.name'], cwd),
		tryRun(executor, ['config', '--local', '--get', 'user.email'], cwd),
		tryRun(executor, ['config', '--global', '--get', 'user.name'], cwd),
		tryRun(executor, ['config', '--global', '--get', 'user.email'], cwd),
		tryRun(executor, ['remote', '-v'], cwd),
	]);
	const listRemoteUrls: string[] = [];
	for (const line of (remotes ?? '').split('\n')) {
		const url = line.split('\t')[1]?.split(' ')[0];
		if (url && !listRemoteUrls.includes(url)) listRemoteUrls.push(url);
	}
	return {
		name,
		email,
		hasLocalName: localName !== null,
		hasLocalEmail: localEmail !== null,
		listRemoteUrls,
		globalName,
		globalEmail,
	};
}

/** Set `user.name`/`user.email` in the repository's local config. */
export async function setLocalIdentity(
	executor: GitExecutor,
	cwd: string,
	name: string,
	email: string
): Promise<void> {
	await executor.run(['config', '--local', 'user.name', name], cwd);
	await executor.run(['config', '--local', 'user.email', email], cwd);
}

/** Remove the repository's local identity override, falling back to the global config. */
export async function clearLocalIdentity(executor: GitExecutor, cwd: string): Promise<void> {
	await tryRun(executor, ['config', '--local', '--unset', 'user.name'], cwd);
	await tryRun(executor, ['config', '--local', '--unset', 'user.email'], cwd);
}
