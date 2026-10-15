import type { BlameCommit } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

export interface BlameResult {
	listLines: string[];
	listLineHashes: string[];
	mapCommits: Record<string, BlameCommit>;
}

/** Blame never writes the index, so it runs beside a commit without taking `.git/index.lock`. */
export function blameArgs(path: string, rev?: string): string[] {
	return ['blame', '--porcelain', ...(rev ? [rev] : []), '--', path];
}

const HEADER = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/;

/**
 * Parse `git blame --porcelain`.
 *
 * Each line of the file is a header (`<hash> <orig> <final> [<count>]`), then — only the first time
 * that commit appears — its `author`, `author-time`, `summary` and other fields, then the line itself
 * behind a tab. Later lines of a commit already seen carry the header alone, so the details are kept
 * per commit, not per line.
 */
export function parseBlame(output: string): BlameResult {
	const listLines: string[] = [];
	const listLineHashes: string[] = [];
	const mapCommits: Record<string, BlameCommit> = {};
	let current: string | null = null;
	for (const line of output.split('\n')) {
		if (line.startsWith('\t')) {
			if (current === null) continue;
			listLines.push(line.slice(1));
			listLineHashes.push(current);
			continue;
		}
		const header = HEADER.exec(line);
		if (header) {
			current = header[1];
			mapCommits[current] ??= { author: '', authoredAt: 0, summary: '' };
			continue;
		}
		if (current === null) continue;
		const space = line.indexOf(' ');
		const field = space === -1 ? line : line.slice(0, space);
		const value = space === -1 ? '' : line.slice(space + 1);
		if (field === 'author') mapCommits[current].author = value;
		else if (field === 'author-time')
			mapCommits[current].authoredAt = Number.parseInt(value, 10) || 0;
		else if (field === 'summary') mapCommits[current].summary = value;
	}
	return { listLines, listLineHashes, mapCommits };
}

export async function getBlame(
	executor: GitExecutor,
	cwd: string,
	path: string,
	rev?: string
): Promise<BlameResult> {
	return parseBlame(await executor.run(blameArgs(path, rev), cwd));
}
