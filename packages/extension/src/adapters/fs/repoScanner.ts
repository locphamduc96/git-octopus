import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoInfo } from '@git-octopus/shared';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'target', 'vendor']);

/**
 * Find Git repositories under the given workspace roots.
 *
 * A directory counts as a repository when it contains `.git` (a directory, or a file for
 * worktrees/submodules). Scanning stops descending once a repository is found, and `fs.stat`
 * is used so symlinked repositories are followed.
 */
export async function findRepos(listRoots: string[], maxDepth = 3): Promise<RepoInfo[]> {
	const listFound: string[] = [];
	const seen = new Set<string>();

	async function scan(dir: string, depth: number): Promise<void> {
		const real = await fs.realpath(dir).catch(() => dir);
		if (seen.has(real)) return;
		seen.add(real);

		if (await isRepo(dir)) {
			listFound.push(dir);
			return;
		}
		if (depth >= maxDepth) return;

		const listEntries = await fs.readdir(dir).catch(() => []);
		for (const name of listEntries) {
			if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
			const full = path.join(dir, name);
			const stat = await fs.stat(full).catch(() => null);
			if (stat?.isDirectory()) await scan(full, depth + 1);
		}
	}

	for (const root of listRoots) {
		await scan(root, 0);
	}

	return listFound
		.map((repoPath) => ({ path: repoPath, name: path.basename(repoPath) }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

async function isRepo(dir: string): Promise<boolean> {
	return fs
		.stat(path.join(dir, '.git'))
		.then(() => true)
		.catch(() => false);
}
