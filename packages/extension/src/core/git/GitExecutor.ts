/**
 * Port: run a git command and return its stdout. Implemented by an adapter (e.g. spawning the
 * `git` CLI). Kept free of `vscode`/`child_process` so `core` stays pure and testable.
 */
export interface GitExecutor {
	/**
	 * `listOkCodes` names non-zero exit codes that still mean success — `git diff --no-index`
	 * exits 1 whenever the files differ, with the diff on stdout.
	 */
	run(args: string[], cwd: string, listOkCodes?: number[]): Promise<string>;
}
