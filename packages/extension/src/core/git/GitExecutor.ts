/**
 * Port: run a git command and return its stdout. Implemented by an adapter (e.g. spawning the
 * `git` CLI). Kept free of `vscode`/`child_process` so `core` stays pure and testable.
 */
export interface GitExecutor {
	run(args: string[], cwd: string): Promise<string>;
}
