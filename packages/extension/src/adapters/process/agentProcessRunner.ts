import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as os from 'node:os';

/**
 * Runs an agent CLI once: prompt in on stdin, everything buffered out. The impure sibling of
 * `gitProcessExecutor`, with the differences an agent call needs — a hard timeout (a model call
 * can hang in ways `git` cannot), cancellation by key, and a PATH widened to where CLI tools
 * actually live when VS Code was launched from the dock instead of a shell.
 */

export interface AgentRunResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Thrown (as the rejection message) when the run ended because `cancel` was called. */
export const CANCELLED = 'cancelled';

function widenedPath(): string {
	const home = os.homedir();
	const listExtra = ['/usr/local/bin', '/opt/homebrew/bin', `${home}/.local/bin`];
	const current = process.env.PATH ?? '';
	const listMissing = listExtra.filter((dir) => !current.split(':').includes(dir));
	return listMissing.length === 0 ? current : `${current}:${listMissing.join(':')}`;
}

export class AgentProcessRunner {
	private readonly mapRunning = new Map<number, ChildProcessWithoutNullStreams>();
	private readonly setCancelled = new Set<number>();

	/** First line of `<bin> --version`, or null when the binary is missing or broken. */
	public version(bin: string): Promise<string | null> {
		return new Promise((resolve) => {
			let child: ChildProcessWithoutNullStreams;
			try {
				child = spawn(bin, ['--version'], { env: { ...process.env, PATH: widenedPath() } });
			} catch {
				resolve(null);
				return;
			}
			let stdout = '';
			const timer = setTimeout(() => {
				child.kill();
				resolve(null);
			}, 10_000);
			child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
			child.on('error', () => {
				clearTimeout(timer);
				resolve(null);
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				const line = stdout.trim().split('\n')[0]?.trim();
				resolve(code === 0 && line ? line : null);
			});
		});
	}

	/**
	 * Run once, writing `stdinText` and buffering the answer. Resolves with the exit code — a
	 * non-zero exit is an answer to interpret, not an exception. Rejects on spawn failure,
	 * timeout, output overflow, and cancellation (message {@link CANCELLED}).
	 */
	public run(
		bin: string,
		listArgs: string[],
		cwd: string,
		stdinText: string,
		key: number,
		timeoutMs: number = DEFAULT_TIMEOUT_MS
	): Promise<AgentRunResult> {
		return new Promise((resolve, reject) => {
			const child = spawn(bin, listArgs, {
				cwd,
				env: { ...process.env, PATH: widenedPath() },
			});
			this.mapRunning.set(key, child);
			let stdout = '';
			let stderr = '';
			let settled = false;
			const finish = (action: () => void): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.mapRunning.delete(key);
				action();
			};
			const timer = setTimeout(() => {
				finish(() => reject(new Error(`The agent did not answer within ${timeoutMs / 1000}s.`)));
				child.kill();
			}, timeoutMs);
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString('utf8');
				if (stdout.length > MAX_OUTPUT_BYTES) {
					finish(() => reject(new Error('The agent produced more than 8 MB of output.')));
					child.kill();
				}
			});
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString('utf8');
				if (stderr.length > MAX_OUTPUT_BYTES) {
					finish(() => reject(new Error('The agent produced more than 8 MB of output.')));
					child.kill();
				}
			});
			child.on('error', (error) => finish(() => reject(error)));
			child.on('close', (code) => {
				finish(() => {
					if (this.setCancelled.delete(key)) reject(new Error(CANCELLED));
					else resolve({ stdout, stderr, code });
				});
			});
			child.stdin.on('error', () => {
				// A CLI that exits before reading (bad flags, no login) resets the pipe; the close
				// handler already carries the real story, so a stdin EPIPE must not crash the host.
			});
			child.stdin.write(stdinText);
			child.stdin.end();
		});
	}

	/** Kill the run started with this key, making its promise reject with {@link CANCELLED}. */
	public cancel(key: number): void {
		const child = this.mapRunning.get(key);
		if (!child) return;
		this.setCancelled.add(key);
		child.kill();
	}
}
