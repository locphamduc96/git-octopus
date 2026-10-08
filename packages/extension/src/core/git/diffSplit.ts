/**
 * Cutting one whole-tree `git diff` back into per-file text, and sizing the calls that produce it.
 *
 * The AI-commit prompt wants the raw unified diff of each file it names. Asking git once per file
 * is the obvious way to get that and the wrong one: it spawns a process per staged file, all at
 * once, every one of them contending for `.git/index.lock`.
 *
 * Kept apart from {@link parseUnifiedDiff}, which answers a different question — it returns
 * structured hunks for rendering and deliberately drops the `diff --git` preamble, so it cannot
 * tell where one file's text ends and the next begins.
 */

/**
 * Split a multi-file unified diff into the raw text belonging to each requested path.
 *
 * Matching is by exact header, built from the paths the caller already knows, rather than by
 * parsing `diff --git a/X b/Y` — that header has no unambiguous boundary between the two halves
 * when a path contains a space, and comparing against a known set sidesteps the question entirely.
 * A file whose header does not match anything asked for is simply absent from the result, which is
 * the same outcome the per-file version had when its diff failed.
 *
 * Expects the diff to have been produced with `core.quotePath=false` and `--no-renames`: the first
 * keeps non-ASCII paths literal instead of C-quoted (`"a/h\303\251llo.ts"`), the second keeps a
 * renamed file rendered against its own path.
 */
export function splitDiffByPath(output: string, listPaths: string[]): Map<string, string> {
	const mapByHeader = new Map<string, string>();
	for (const path of listPaths) mapByHeader.set(`diff --git a/${path} b/${path}`, path);

	const mapResult = new Map<string, string>();
	let current: string | null = null;
	let listLines: string[] = [];

	const flush = (): void => {
		if (current !== null && listLines.length > 0) mapResult.set(current, listLines.join('\n'));
		listLines = [];
	};

	for (const line of output.split('\n')) {
		if (line.startsWith('diff --git ')) {
			flush();
			current = mapByHeader.get(line) ?? null;
		}
		if (current !== null) listLines.push(line);
	}
	flush();
	return mapResult;
}

/**
 * How many bytes of pathspec one `git diff` invocation may carry.
 *
 * Well under the ~1 MB a macOS `execve` accepts, because the paths are only part of the argv and
 * because a smaller chunk also bounds how much diff one call can return — the executor kills a
 * command that produces more than 64 MB, and a smaller chunk means one generated file cannot take
 * every other file's diff down with it.
 */
const ARGV_BUDGET_BYTES = 96 * 1024;

/**
 * Group paths so each group fits in one command. A single path longer than the budget still gets
 * its own group: dropping it would silently lose a file, and git will take it.
 */
export function chunkPaths(
	listPaths: string[],
	budgetBytes: number = ARGV_BUDGET_BYTES
): string[][] {
	const listChunks: string[][] = [];
	let listCurrent: string[] = [];
	let bytes = 0;
	for (const path of listPaths) {
		// +1 for the separator the kernel counts alongside each argv entry.
		const cost = Buffer.byteLength(path, 'utf8') + 1;
		if (listCurrent.length > 0 && bytes + cost > budgetBytes) {
			listChunks.push(listCurrent);
			listCurrent = [];
			bytes = 0;
		}
		listCurrent.push(path);
		bytes += cost;
	}
	if (listCurrent.length > 0) listChunks.push(listCurrent);
	return listChunks;
}
