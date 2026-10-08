/**
 * Diffs of the working tree that never write `.git/index`.
 *
 * Porcelain `git diff HEAD` refreshes the index's stat cache and writes it back, taking
 * `.git/index.lock` to do so — even under `GIT_OPTIONAL_LOCKS=0`. Every read would then compete with
 * the user's own commit, in this window, in another window, or in another client. Plumbing
 * `diff-index` compares the same two sides and leaves the index alone.
 *
 * Measured byte-identical to the porcelain forms they replace for `-p` and `--numstat`, stat-dirty
 * files included — a file whose mtime moved but whose content did not is dropped at the content
 * comparison either way (feature 076 §1.1). The `--name-only`/`--name-status`/`--raw` forms do NOT
 * match: without the refresh they list stat-dirty files as modified, so none of them belong here.
 */

/** git's empty tree — what HEAD effectively is before the first commit exists. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The working tree against `base` as a patch; `listFlags` go before the tree-ish. */
export function workingTreeDiffArgs(
	base: string,
	listFlags: string[],
	listPaths: string[]
): string[] {
	return ['diff-index', '-p', ...listFlags, base, '--', ...listPaths];
}

/**
 * The staged files' patches for the AI commit prompt, one command for many paths.
 *
 * `core.quotePath=false` keeps a non-ASCII path in the header as the literal string `status`
 * reported, which the splitter matches on. `--no-renames` renders a renamed file against its own
 * path; a pure rename would otherwise be a header with no hunks.
 */
export function promptDiffArgs(listPaths: string[]): string[] {
	return [
		'-c',
		'core.quotePath=false',
		...workingTreeDiffArgs('HEAD', ['--no-renames'], listPaths),
	];
}

/**
 * Line counts per staged file. `-M` because porcelain `diff` detects renames by default
 * (`diff.renames`) and plumbing does not — without it a rename reads as a whole-file add plus a
 * whole-file delete instead of the `old => new` line `parseNumstat` folds onto the new path.
 */
export function promptNumstatArgs(): string[] {
	return ['-c', 'core.quotePath=false', 'diff-index', '--numstat', '-M', 'HEAD'];
}
