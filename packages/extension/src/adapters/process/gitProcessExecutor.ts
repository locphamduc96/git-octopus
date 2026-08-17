import { spawn } from 'node:child_process';
import type { AskpassBridge, GitAuthRequest, GitExecutor } from '../../core/git/GitExecutor.js';

/**
 * Everything buffered from one git call is capped: a runaway command (a million-line diff of a
 * generated bundle) is killed instead of being held in memory as one giant string.
 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Runs the system `git` binary. The impure adapter behind the {@link GitExecutor} port. */
export class GitProcessExecutor implements GitExecutor {
	/** No bridge means no interactive auth: commands fail fast exactly as before. */
	public constructor(private readonly askpass?: AskpassBridge) {}

	public run(
		args: string[],
		cwd: string,
		listOkCodes?: number[],
		auth?: GitAuthRequest
	): Promise<string> {
		return new Promise((resolve, reject) => {
			// Only a command that declared itself interactive gets the askpass lease — and the
			// lease dies with the process, so nothing can ask in this invocation's name later.
			const lease = auth && this.askpass ? this.askpass.register({ cwd, ...auth }) : null;
			const child = spawn('git', args, {
				cwd,
				// No terminal is attached, so a credential prompt on stdin would hang forever with a
				// spinner in the view. The askpass lease (when present) is the sanctioned way to ask.
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(lease ? lease.mapEnv : {}) },
			});
			let stdout = '';
			let stderr = '';
			let settled = false;
			const overflow = (): void => {
				if (settled) return;
				settled = true;
				child.kill();
				reject(new Error(`git ${args[0]} produced more than 64 MB of output and was stopped.`));
			};
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString('utf8');
				if (stdout.length > MAX_OUTPUT_BYTES) overflow();
			});
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString('utf8');
				if (stderr.length > MAX_OUTPUT_BYTES) overflow();
			});
			child.on('error', (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});
			child.on('close', (code) => {
				if (lease) this.askpass?.release(lease.nonce);
				if (settled) return;
				settled = true;
				if (code === 0 || (code !== null && listOkCodes?.includes(code))) {
					resolve(stdout);
				} else {
					reject(new Error(stderr.trim() || `git exited with code ${code}`));
				}
			});
		});
	}
}
