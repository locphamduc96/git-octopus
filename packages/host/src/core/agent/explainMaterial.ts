import type { ExplainTarget, FileChange } from '@git-octopus/shared';
import type { GitExecutor } from '../git/GitExecutor.js';
import { getStatus } from '../git/gitService.js';
import { chunkPaths, splitDiffByPath } from '../git/diffSplit.js';
import { parseNumstat } from '../git/numstatParser.js';
import { EMPTY_TREE, promptDiffArgs, promptNumstatArgs } from '../git/workingTreeDiff.js';
import { classifyChanges, type ChangeEntry } from './classifyChanges.js';
import type { PromptFile } from './commitPrompt.js';
import type { ExplainCommit, ExplainPromptInput } from './explainPrompt.js';

/** What the explain prompt is built from, before the user's language is added. */
export type ExplainMaterial = Omit<ExplainPromptInput, 'language'>;

export interface ExplainOptions {
	/** `gitOctopus.aiCommit.excludePatterns`: what never leaves the machine as content. */
	listExcludePatterns: string[];
	/** Size on disk of a working-tree file, for the same "too big to read" cut the commit flow makes. */
	sizeOf?: (path: string) => Promise<number | undefined>;
}

/** A file changed by more lines than this is named with its counts, not shown. */
export const MAX_EXPLAIN_FILE_LINES = 2_000;
/** A branch's commits past this many are counted, not listed. */
export const MAX_EXPLAIN_COMMITS = 50;

const LOG_FORMAT = '%H%x00%an%x00%s%x00%b%x1e';
const QUOTE_OFF = ['-c', 'core.quotePath=false'];

export function parseExplainLog(output: string): ExplainCommit[] {
	return output
		.split('\x1e')
		.map((record) => record.replace(/^\n/, ''))
		.filter((record) => record.trim() !== '')
		.map((record) => {
			const [hash = '', author = '', subject = '', body = ''] = record.split('\0');
			return { hash, author, subject, body: body.trim() };
		});
}

/** `name-status` lines — `M\tpath` — as file changes. Renames are off, so there is one path each. */
export function parseNameStatus(output: string): FileChange[] {
	return output
		.split('\n')
		.filter((line) => line.includes('\t'))
		.map((line) => {
			const [status, ...rest] = line.split('\t');
			return { status: status.charAt(0) as FileChange['status'], path: rest.join('\t') };
		});
}

/**
 * Collect what the agent is shown: the commits, every changed file by name with its counts, and
 * the diffs of the files worth reading. Throws with a message fit for the user when there is
 * nothing to explain.
 */
export async function gatherExplainMaterial(
	executor: GitExecutor,
	cwd: string,
	target: ExplainTarget,
	options: ExplainOptions
): Promise<ExplainMaterial> {
	switch (target.kind) {
		case 'commit':
			return commitMaterial(executor, cwd, target.hash, options);
		case 'branch':
			return branchMaterial(executor, cwd, target.ref, target.label, options);
		case 'working':
			return workingMaterial(executor, cwd, options);
	}
}

async function commitMaterial(
	executor: GitExecutor,
	cwd: string,
	hash: string,
	options: ExplainOptions
): Promise<ExplainMaterial> {
	if (!/^[0-9a-f]{7,64}$/.test(hash)) throw new Error('That is not a commit hash.');
	const [commit] = parseExplainLog(
		await executor.run(['log', '-1', `--format=${LOG_FORMAT}`, hash], cwd)
	);
	if (!commit) throw new Error('The commit could not be read.');
	// A merge is explained by what it brought into the branch it landed on: its first parent.
	const parent = (await executor.run(['rev-list', '--parents', '-n', '1', hash], cwd))
		.trim()
		.split(' ')[1];
	return {
		title: `commit ${hash.slice(0, 8)} — ${commit.subject}`,
		listCommits: [commit],
		moreCommits: 0,
		listFiles: await rangeFiles(executor, cwd, parent ?? EMPTY_TREE, hash, options),
	};
}

/**
 * The branch against: the checked-out branch, or — when the branch *is* the checked-out one —
 * the repository's main line, `origin/HEAD` first.
 */
async function branchBase(executor: GitExecutor, cwd: string, ref: string): Promise<string | null> {
	const current = (
		await executor.run(['symbolic-ref', '--quiet', 'HEAD'], cwd).catch(() => '')
	).trim();
	const listCandidates =
		current !== '' && current !== ref
			? [current]
			: [
					(
						await executor
							.run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd)
							.catch(() => '')
					).trim(),
					'refs/heads/main',
					'refs/heads/master',
					'refs/remotes/origin/main',
					'refs/remotes/origin/master',
				];
	for (const candidate of listCandidates) {
		if (candidate === '' || candidate === ref || candidate === current) continue;
		const exists = await executor
			.run(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd)
			.then(() => true)
			.catch(() => false);
		if (exists) return candidate;
	}
	return current !== '' && current !== ref ? current : null;
}

function shortRef(ref: string): string {
	return ref.replace(/^refs\/(heads|remotes)\//, '');
}

async function branchMaterial(
	executor: GitExecutor,
	cwd: string,
	ref: string,
	label: string,
	options: ExplainOptions
): Promise<ExplainMaterial> {
	if (ref.startsWith('-')) throw new Error(`${label} is not a branch.`);
	await executor.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).catch(() => {
		throw new Error(`${label} no longer exists.`);
	});
	const base = await branchBase(executor, cwd, ref);
	if (!base) throw new Error(`There is no other branch to compare ${label} with.`);
	const mergeBase = (await executor.run(['merge-base', base, ref], cwd)).trim();
	const total = Number(
		(await executor.run(['rev-list', '--count', `${mergeBase}..${ref}`], cwd)).trim()
	);
	if (total === 0) throw new Error(`${label} has no commits that ${shortRef(base)} does not have.`);
	const listCommits = parseExplainLog(
		await executor.run(
			[
				'log',
				'--reverse',
				`--format=${LOG_FORMAT}`,
				`-n${MAX_EXPLAIN_COMMITS}`,
				`${mergeBase}..${ref}`,
			],
			cwd
		)
	);
	return {
		title: `branch ${label} — ${total} commit${total === 1 ? '' : 's'} not on ${shortRef(base)}`,
		listCommits,
		moreCommits: Math.max(0, total - listCommits.length),
		listFiles: await rangeFiles(executor, cwd, mergeBase, ref, options),
	};
}

/** The files between two tree-ishes, with counts, and diffs for the ones worth reading. */
async function rangeFiles(
	executor: GitExecutor,
	cwd: string,
	from: string,
	to: string,
	options: ExplainOptions
): Promise<PromptFile[]> {
	const listFlags = ['diff-tree', '-r', '--no-renames'];
	const [nameStatus, numstat] = await Promise.all([
		executor.run([...QUOTE_OFF, ...listFlags, '--name-status', from, to], cwd),
		executor.run([...QUOTE_OFF, ...listFlags, '--numstat', from, to], cwd),
	]);
	return withDiffs(
		parseNameStatus(nameStatus).map((change) => ({ path: change.path, status: change.status })),
		parseNumstat(numstat),
		options,
		(listPaths) =>
			executor.run([...QUOTE_OFF, ...listFlags, '-p', from, to, '--', ...listPaths], cwd)
	);
}

async function workingMaterial(
	executor: GitExecutor,
	cwd: string,
	options: ExplainOptions
): Promise<ExplainMaterial> {
	const { working, isUnborn, branch } = await getStatus(executor, cwd);
	if (isUnborn) throw new Error('The repository has no commits yet to compare the changes with.');
	const mapByPath = new Map<string, ChangeEntry>();
	for (const change of [...working.staged, ...working.unstaged]) {
		if (!mapByPath.has(change.path))
			mapByPath.set(change.path, { path: change.path, status: change.status });
	}
	if (mapByPath.size === 0) throw new Error('There are no uncommitted changes to explain.');
	const listEntries = await Promise.all(
		[...mapByPath.values()].map(async (entry) => ({
			...entry,
			bytes: entry.status === 'D' ? undefined : await options.sizeOf?.(entry.path),
		}))
	);
	const mapCounts = parseNumstat(await executor.run(promptNumstatArgs(), cwd).catch(() => ''));
	const listFiles = await withDiffs(listEntries, mapCounts, options, async (listPaths) => {
		const listTracked = listPaths.filter((path) => mapByPath.get(path)?.status !== '?');
		const listUntracked = listPaths.filter((path) => mapByPath.get(path)?.status === '?');
		const listOutputs = await Promise.all([
			listTracked.length > 0 ? executor.run(promptDiffArgs(listTracked), cwd) : '',
			// A new file has no diff against HEAD; against nothing, it reads as all-added.
			...listUntracked.map((path) =>
				executor
					.run(
						[...QUOTE_OFF, 'diff', '--no-index', '--no-color', '--', '/dev/null', path],
						cwd,
						[1]
					)
					.catch(() => '')
			),
		]);
		return listOutputs.join('\n');
	});
	return {
		title: `uncommitted changes on ${branch ?? 'a detached HEAD'}`,
		listCommits: [],
		moreCommits: 0,
		listFiles,
	};
}

/**
 * Sort the files into tiers, then read diffs for the source ones only — what is excluded never
 * leaves the machine, and generated or huge files are not worth the prompt.
 */
async function withDiffs(
	listEntries: ChangeEntry[],
	mapCounts: Map<string, { additions: number; deletions: number }>,
	options: ExplainOptions,
	readDiff: (listPaths: string[]) => Promise<string>
): Promise<PromptFile[]> {
	const listClassified = classifyChanges(listEntries, options.listExcludePatterns).map((entry) => {
		const counts = mapCounts.get(entry.path);
		const huge =
			counts !== undefined && counts.additions + counts.deletions > MAX_EXPLAIN_FILE_LINES;
		return { ...entry, tier: entry.tier === 'source' && huge ? ('asset' as const) : entry.tier };
	});
	const listSource = listClassified
		.filter((entry) => entry.tier === 'source')
		.map((entry) => entry.path);
	const mapDiffs = new Map<string, string>();
	for (const listChunk of chunkPaths(listSource)) {
		const output = await readDiff(listChunk).catch(() => '');
		for (const [path, diff] of splitDiffByPath(output, listChunk)) mapDiffs.set(path, diff);
	}
	return listClassified.map((entry) => {
		const file: PromptFile = {
			path: entry.path,
			status: entry.status,
			tier: entry.tier,
			...(mapCounts.get(entry.path) ?? {}),
		};
		const diff = mapDiffs.get(entry.path);
		return diff === undefined ? file : { ...file, diff };
	});
}
