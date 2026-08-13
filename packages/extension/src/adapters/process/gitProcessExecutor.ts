import { spawn } from 'node:child_process';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** Runs the system `git` binary. The impure adapter behind the {@link GitExecutor} port. */
export class GitProcessExecutor implements GitExecutor {
	public run(args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn('git', args, { cwd });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
			child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
			child.on('error', reject);
			child.on('close', (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(stderr.trim() || `git exited with code ${code}`));
				}
			});
		});
	}
}
