import { existsSync } from 'node:fs';
import type { GitAuthRequest, GitExecutor } from '@git-octopus/host/core/git/GitExecutor';
import { DEFAULT_GIT_PROGRAM } from '@git-octopus/host/adapters/process/gitProgram';

/** What the operating system says when it could not start a program at all. */
const LIST_START_FAILURES = ['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM'];

function startFailureCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) return null;
	const { code, syscall } = error as { code?: unknown; syscall?: unknown };
	if (typeof code !== 'string' || !LIST_START_FAILURES.includes(code)) return null;
	return typeof syscall === 'string' && syscall.startsWith('spawn') ? code : null;
}

/**
 * One sentence naming the program that was tried and why it did not start, with the way out. The
 * program is `git` on the PATH when the setting is empty, and says so.
 */
export function describeGitFailure(program: string, code: string): string {
	const fix = 'Set the Git path in Settings → General → Desktop, or install git.';
	if (program === DEFAULT_GIT_PROGRAM) {
		return `Git Octopus: git was not found on your PATH (${code}). ${fix}`;
	}
	const why =
		code === 'ENOENT' || code === 'ENOTDIR'
			? 'no such file'
			: 'it is not an executable you may run';
	return `Git Octopus: cannot run git at ${program} — ${why} (${code}). ${fix}`;
}

export interface GitAvailabilityOptions {
	/** The program git would be started as right now. */
	program: () => string;
	/** Said once for each program that fails, until git runs again. */
	onUnavailable: (message: string) => void;
	/** A missing working directory fails to start git just the same; it is not git's fault. */
	directoryExists?: (cwd: string) => boolean;
}

/**
 * Turns "git could not be started" into a message that names the program tried, and says it in the
 * view once. Every other failure — a git that ran and refused — passes through untouched.
 */
export class GitAvailabilityExecutor implements GitExecutor {
	private reported: string | null = null;

	public constructor(
		private readonly inner: GitExecutor,
		private readonly options: GitAvailabilityOptions
	) {}

	public async run(
		args: string[],
		cwd: string,
		listOkCodes?: number[],
		auth?: GitAuthRequest
	): Promise<string> {
		try {
			const out = await this.inner.run(args, cwd, listOkCodes, auth);
			this.reported = null;
			return out;
		} catch (error) {
			const code = startFailureCode(error);
			const exists = this.options.directoryExists ?? existsSync;
			if (code === null || !exists(cwd)) throw error;
			const program = this.options.program();
			const message = describeGitFailure(program, code);
			if (this.reported !== program) {
				this.reported = program;
				this.options.onUnavailable(message);
			}
			throw new Error(message);
		}
	}

	/** Starts git once, so a wrong path is announced when the window opens, not at the first click. */
	public async verify(cwd: string): Promise<boolean> {
		try {
			await this.run(['--version'], cwd);
			return true;
		} catch {
			return false;
		}
	}
}
