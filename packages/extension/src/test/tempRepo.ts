import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * A throwaway Git repository for integration tests: real `git`, real object store, deleted when
 * the test is done. Identity and signing are pinned locally so the host machine's config can
 * never make a commit fail or differ.
 */
export interface TempRepo {
	cwd: string;
	git: (...args: string[]) => Promise<string>;
	commit: (fileName: string, content: string, message: string) => Promise<string>;
	dispose: () => Promise<void>;
}

export async function createTempRepo(): Promise<TempRepo> {
	const cwd = await mkdtemp(path.join(tmpdir(), 'git-octopus-test-'));
	const git = (...args: string[]): Promise<string> =>
		new Promise((resolve, reject) => {
			execFile(
				'git',
				args,
				{ cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
				(error, stdout, stderr) => {
					if (error) reject(new Error(stderr.trim() || error.message));
					else resolve(stdout);
				}
			);
		});
	await git('init', '--initial-branch=main');
	await git('config', 'user.name', 'Test');
	await git('config', 'user.email', 'test@example.invalid');
	await git('config', 'commit.gpgsign', 'false');
	const commit = async (fileName: string, content: string, message: string): Promise<string> => {
		await writeFile(path.join(cwd, fileName), content);
		await git('add', '--', fileName);
		await git('commit', '-m', message);
		return (await git('rev-parse', 'HEAD')).trim();
	};
	return {
		cwd,
		git,
		commit,
		dispose: () => rm(cwd, { recursive: true, force: true }),
	};
}
