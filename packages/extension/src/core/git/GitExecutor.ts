/**
 * Port: run a git command and return its stdout. Implemented by an adapter (e.g. spawning the
 * `git` CLI). Kept free of `vscode`/`child_process` so `core` stays pure and testable.
 */
export interface GitExecutor {
	/**
	 * `listOkCodes` names non-zero exit codes that still mean success — `git diff --no-index`
	 * exits 1 whenever the files differ, with the diff on stdout.
	 *
	 * `auth` opts a command into interactive authentication: only a call that passes it may
	 * cause the user to be prompted, and the prompt UI's trusted title comes from here — never
	 * from the prompt text git relays. Local commands must not pass it, so their hooks never
	 * see the askpass channel.
	 */
	run(args: string[], cwd: string, listOkCodes?: number[], auth?: GitAuthRequest): Promise<string>;
}

/** What a network command declares about itself before it may ask the user anything. */
export interface GitAuthRequest {
	/** Short human label ("push", "fetch") shown in the prompt title. */
	operation: string;
	/** Hosts this repository's remotes resolve to — the only hosts a prompt may claim. */
	listHosts: string[];
}

/** The auth request plus where it runs — what the askpass server knows about an invocation. */
export interface GitAuthContext extends GitAuthRequest {
	cwd: string;
}

/**
 * Grants per-invocation askpass leases. Implemented by the askpass server adapter; absent when
 * askpass is unavailable (setup failed, platform unsupported, or the user runs their own).
 */
export interface AskpassBridge {
	register(context: GitAuthContext): { nonce: string; mapEnv: Record<string, string> };
	release(nonce: string): void;
}
