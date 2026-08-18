/** What identifies one diff request; the view's richer target objects satisfy it structurally. */
export interface DiffKeySource {
	path: string;
	hash?: string;
	fromHash?: string;
	toHash?: string;
	untracked?: boolean;
}

/**
 * The identity of a diff request. Echoed back by the host untouched, so a reply landing after
 * the user moved on is recognisably stale; also the cache key for hunks and syntax tokens.
 */
export function buildDiffKey(target: DiffKeySource, context: number): string {
	return [
		target.hash ?? '',
		target.fromHash ?? '',
		target.toHash ?? '',
		target.untracked ? 'u' : '',
		context,
		target.path,
	].join('|');
}

/**
 * Only a diff pinned to commit hashes may be cached: its content can never change. A working
 * tree or untracked diff has no revision in its key, so a cached copy would keep showing the
 * file as it was the first time it was opened.
 */
export function isCacheableDiffKey(key: string): boolean {
	const [hash, fromHash, toHash] = key.split('|');
	return hash !== '' || (fromHash !== '' && toHash !== '');
}
