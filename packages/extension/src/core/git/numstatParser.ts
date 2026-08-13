export interface LineCounts {
	additions: number;
	deletions: number;
}

/**
 * Parse `git diff-tree --numstat` output into per-path line counts.
 *
 * Each line is `<added>\t<deleted>\t<path>`; binary files report `-` for both. Renames are
 * reported as `old => new`, optionally with a shared prefix/suffix (`src/{a => b}/x.ts`), so the
 * new path is reconstructed before it is used as the key.
 */
export function parseNumstat(output: string): Map<string, LineCounts> {
	const mapCounts = new Map<string, LineCounts>();
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [added, deleted, ...rest] = line.split('\t');
		const path = rest.join('\t');
		if (path === '') continue;
		mapCounts.set(newPathOf(path), {
			additions: Number.parseInt(added, 10) || 0,
			deletions: Number.parseInt(deleted, 10) || 0,
		});
	}
	return mapCounts;
}

function newPathOf(path: string): string {
	const braced = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
	if (braced) {
		const [, prefix, , to, suffix] = braced;
		return `${prefix}${to}${suffix}`.replace('//', '/');
	}
	const arrow = path.indexOf(' => ');
	return arrow === -1 ? path : path.slice(arrow + 4);
}
