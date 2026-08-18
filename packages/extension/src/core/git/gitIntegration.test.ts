import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { getFileDiff, getRemoteNames } from './gitService';
import { listCandidateRemotes } from './remoteOwnership';
import { parseAheadBehind } from './checkoutPlan';

/** The executor and diff pipeline against a real repository, not a scripted fake. */
describe('git integration', () => {
	let repo: TempRepo;
	const executor = new GitProcessExecutor();

	beforeAll(async () => {
		repo = await createTempRepo();
	});

	afterAll(async () => {
		await repo.dispose();
	});

	it('runs git and resolves stdout', async () => {
		await repo.commit('a.txt', 'hello\n', 'first');
		const output = await executor.run(['rev-parse', '--is-inside-work-tree'], repo.cwd);
		expect(output.trim()).toBe('true');
	});

	it('rejects with stderr when git fails', async () => {
		await expect(executor.run(['rev-parse', '--verify', 'no-such-ref'], repo.cwd)).rejects.toThrow(
			/no-such-ref|Needed a single revision/
		);
	});

	it('diffs a renamed file as old → new instead of a whole-file add', async () => {
		const listLines = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join('\n');
		await repo.commit('old-name.txt', `${listLines}\n`, 'add file');
		await repo.git('mv', 'old-name.txt', 'new-name.txt');
		await repo.commit('new-name.txt', `${listLines}\ntail\n`, 'rename and touch');
		const hash = (await repo.git('rev-parse', 'HEAD')).trim();

		const withOldPath = await getFileDiff(executor, repo.cwd, {
			path: 'new-name.txt',
			oldPath: 'old-name.txt',
			hash,
			context: 3,
		});
		// Rename detected: only the touched tail shows as a change, not all 30 lines.
		const added = withOldPath.listHunks
			.flatMap((hunk) => hunk.listLines)
			.filter((line) => line.kind === 'add');
		expect(added.length).toBe(1);
		expect(added[0].text).toBe('tail');
	});

	it('reports a binary file as a notice instead of hunks', async () => {
		await repo.commit('bin.dat', '\u0000\u0001\u0002', 'binary');
		const hash = (await repo.git('rev-parse', 'HEAD')).trim();
		const result = await getFileDiff(executor, repo.cwd, {
			path: 'bin.dat',
			hash,
			context: 3,
		});
		expect(result.listHunks).toEqual([]);
		expect(result.notice).toMatch(/Binary/);
	});

	// The two answers `checkoutFromRemote` decides on. Both are read off git's exact output, so the
	// shape is worth pinning against a real git rather than a fake that agrees with the parser.
	it('answers whether a local branch exists without failing on the ones that do not', async () => {
		await repo.commit('branchy.txt', 'x\n', 'base');
		await repo.git('branch', 'already-here');

		const present = await executor.run(
			['rev-parse', '--verify', '--quiet', 'refs/heads/already-here'],
			repo.cwd,
			[1]
		);
		expect(present.trim()).toMatch(/^[0-9a-f]{40}$/);

		// Exit code 1 with empty stdout, not a thrown error: "no such branch" is an answer.
		const absent = await executor.run(
			['rev-parse', '--verify', '--quiet', 'refs/heads/never-created'],
			repo.cwd,
			[1]
		);
		expect(absent.trim()).toBe('');
	});

	it('reports an untracked file as a dirty tree, which the excluding form does not', async () => {
		// The auto-fast-forward guard reads this. With `--untracked-files=no` the tree below looks
		// clean, and `merge --ff-only` would then run over work the user has not committed.
		await repo.commit('tracked.txt', 'x\n', 'base');
		await writeFile(path.join(repo.cwd, 'stray.txt'), 'not committed\n');

		const excluding = await executor.run(
			['status', '--porcelain', '--untracked-files=no'],
			repo.cwd
		);
		expect(excluding.trim()).toBe('');

		const including = await executor.run(
			['status', '--porcelain', '--untracked-files=normal'],
			repo.cwd
		);
		expect(including).toContain('stray.txt');

		// Ignored files stay out of it either way, so a build directory cannot block a checkout.
		await writeFile(path.join(repo.cwd, '.gitignore'), 'ignored.txt\n');
		await writeFile(path.join(repo.cwd, 'ignored.txt'), 'noise\n');
		const withIgnored = await executor.run(
			['status', '--porcelain', '--untracked-files=normal'],
			repo.cwd
		);
		expect(withIgnored).not.toContain('ignored.txt');
	});

	it('cannot tell which of two overlapping remotes owns a ref, and says so', async () => {
		// Both remotes are legal, and their default refspecs write the same ref path: `team/origin`
		// fetching its `main`, and `team` fetching a branch literally called `origin/main`. Whichever
		// fetched last owns `refs/remotes/team/origin/main` — git does not settle it either.
		const upstreamA = await createTempRepo();
		const upstreamB = await createTempRepo();
		const clone = await createTempRepo();
		try {
			await upstreamA.commit('f.txt', 'from a\n', 'a');
			await upstreamB.commit('f.txt', 'from b\n', 'b');
			await upstreamB.git('branch', 'origin/main');

			await clone.commit('seed.txt', 'seed\n', 'seed');
			await clone.git('remote', 'add', 'team/origin', upstreamA.cwd);
			await clone.git('remote', 'add', 'team', upstreamB.cwd);

			await clone.git('fetch', 'team/origin');
			const afterFirst = (await clone.git('rev-parse', 'refs/remotes/team/origin/main')).trim();
			await clone.git('fetch', 'team');
			const afterSecond = (await clone.git('rev-parse', 'refs/remotes/team/origin/main')).trim();

			// The ref really does change owner — this is the ambiguity, reproduced.
			expect(afterFirst).not.toBe(afterSecond);
			expect(afterFirst).toBe((await upstreamA.git('rev-parse', 'main')).trim());
			expect(afterSecond).toBe((await upstreamB.git('rev-parse', 'origin/main')).trim());

			const listRemotes = await getRemoteNames(executor, clone.cwd);
			expect(listRemotes.sort()).toEqual(['team', 'team/origin']);
			expect(listCandidateRemotes('refs/remotes/team/origin/main', listRemotes)).toEqual([
				'team/origin',
				'team',
			]);
			// An ordinary ref under the same pair stays unambiguous, so only the overlap is refused.
			expect(listCandidateRemotes('refs/remotes/team/main', listRemotes)).toEqual(['team']);
		} finally {
			await Promise.all([upstreamA.dispose(), upstreamB.dispose(), clone.dispose()]);
		}
	});

	it('counts ahead and behind in that order', async () => {
		await repo.commit('counted.txt', 'base\n', 'shared base');
		await repo.git('branch', 'stand-in-remote');
		await repo.commit('counted.txt', 'local\n', 'local only');
		await repo.git('checkout', 'stand-in-remote');
		await repo.commit('counted.txt', 'remote one\n', 'remote 1');
		await repo.commit('counted.txt', 'remote two\n', 'remote 2');
		await repo.git('checkout', 'main');

		const output = await executor.run(
			['rev-list', '--count', '--left-right', 'main...stand-in-remote'],
			repo.cwd
		);
		expect(parseAheadBehind(output)).toEqual({ ahead: 1, behind: 2 });
	});
});
