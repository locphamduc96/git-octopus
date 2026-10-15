import type { BlameCommit } from '@git-octopus/shared';

/** git's hash for a line that is not committed yet. */
export const UNCOMMITTED_BLAME = '0'.repeat(40);

/**
 * Where each run of lines from one commit starts, and which of two shades it takes.
 *
 * The annotation is written once per run, on its first line; the shades alternate so two runs that
 * happen to sit next to each other still read as two.
 */
export function buildBlameBlocks(listLineHashes: string[]): {
	listStarts: boolean[];
	listParity: number[];
} {
	const listStarts: boolean[] = [];
	const listParity: number[] = [];
	let parity = 1;
	listLineHashes.forEach((hash, index) => {
		const start = index === 0 || listLineHashes[index - 1] !== hash;
		if (start) parity = 1 - parity;
		listStarts.push(start);
		listParity.push(parity);
	});
	return { listStarts, listParity };
}

/** `3d ago`, `5mo ago` — short enough for a column, exact enough to tell old from new. */
export function formatAge(epochSeconds: number, nowMs: number = Date.now()): string {
	const seconds = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds);
	const listSteps: [number, string][] = [
		[60, 's'],
		[60, 'm'],
		[24, 'h'],
		[30, 'd'],
		[12, 'mo'],
	];
	let value = seconds;
	for (const [size, unit] of listSteps) {
		if (value < size) return unit === 's' ? 'just now' : `${value}${unit} ago`;
		value = Math.floor(value / size);
	}
	return `${value}y ago`;
}

/** The text and the hover text of one run's annotation. */
export function blameLabel(
	hash: string,
	commit: BlameCommit | undefined,
	nowMs?: number
): { text: string; detail: string } {
	if (hash === UNCOMMITTED_BLAME) {
		return { text: 'Not committed yet', detail: 'Changed in the working tree' };
	}
	const author = commit?.author ?? '';
	const age = commit ? formatAge(commit.authoredAt, nowMs) : '';
	return {
		text: `${hash.slice(0, 7)} ${author}${age ? ` · ${age}` : ''}`,
		detail: commit
			? `${commit.summary}\n${author}, ${new Date(commit.authoredAt * 1000).toLocaleString()}`
			: hash,
	};
}
