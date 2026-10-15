import { UNCOMMITTED_HASH } from '@git-octopus/shared';

/** What identifies one diff request; the view's richer target objects satisfy it structurally. */
export interface DiffKeySource {
	path: string;
	hash?: string;
	fromHash?: string;
	toHash?: string;
	untracked?: boolean;
	side?: 'unstaged' | 'staged';
}

/**
 * The identity of a diff request. Echoed back by the host untouched, so a reply landing after
 * the user moved on is recognisably stale; also the cache key for hunks and syntax tokens.
 */
export function buildDiffKey(
	target: DiffKeySource,
	context: number,
	ignoreWhitespace = false
): string {
	return [
		target.hash ?? '',
		target.fromHash ?? '',
		target.toHash ?? '',
		target.untracked ? 'u' : (target.side ?? ''),
		ignoreWhitespace ? `${context}w` : context,
		target.path,
	].join('|');
}

/**
 * Only a diff pinned to commit hashes may be cached: its content can never change. A working
 * tree or untracked diff has no revision in its key, so a cached copy would keep showing the
 * file as it was the first time it was opened — and a commit compared with the working tree has
 * the same problem behind a key that does name a revision.
 */
export function isCacheableDiffKey(key: string): boolean {
	const [hash, fromHash, toHash] = key.split('|');
	// A blame key is `blame|<rev>|<path>`: pinned only when it names a revision.
	if (hash === 'blame') return fromHash !== '';
	if (toHash === UNCOMMITTED_HASH) return false;
	return hash !== '' || (fromHash !== '' && toHash !== '');
}

/**
 * The revision on a diff's right-hand side — what blame and file history read from: a commit, or
 * null for the working tree. Undefined for an untracked file, which git has no history of.
 */
export function rightRevision(target: DiffKeySource): string | null | undefined {
	if (target.untracked) return undefined;
	if (target.hash) return target.hash;
	if (target.fromHash && target.toHash) {
		return target.toHash === UNCOMMITTED_HASH ? null : target.toHash;
	}
	return null;
}
