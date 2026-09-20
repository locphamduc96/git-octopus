import { afterEach, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { makeRepoContext } from '../../test/fakeGit';
import { loadCommits } from '../../app/useCases/loadCommits';
import { loadStatus } from '../../app/useCases/loadStatus';
import { getCurrentBranch } from './gitService';

/**
 * A repository between `git init` and its first commit, against real git.
 *
 * `createTempRepo` leaves exactly that state, which is what makes this worth running over the
 * scripted fakes: every string here — `(initial)`, the `ambiguous argument` failure — is git's
 * own output rather than a fixture that could drift from it.
 */
describe('a repository with no commits yet, against real git', () => {
	const executor = new GitProcessExecutor();
	let repo: TempRepo;

	const contextFor = (cwd: string) =>
		makeRepoContext({ executor, cwd, repos: [{ path: cwd, name: 'repo' }] });

	afterEach(async () => {
		await repo.dispose();
	});

	it('is the state git reports as an unborn branch, not a detached HEAD', async () => {
		repo = await createTempRepo();

		const output = await repo.git('status', '--porcelain=v2', '--branch');
		expect(output).toContain('# branch.oid (initial)');
		expect(output).toContain('# branch.head main');
	});

	it('fails the walk when HEAD is passed — the argv this feature removed', async () => {
		repo = await createTempRepo();

		await expect(
			executor.run(['log', '--branches', 'HEAD', '--tags'], repo.cwd)
		).rejects.toThrow(/ambiguous argument 'HEAD'/);
	});

	it('walks fine without HEAD, which is what the graph now asks for', async () => {
		repo = await createTempRepo();

		await expect(executor.run(['log', '--branches', '--tags'], repo.cwd)).resolves.toBe('');
	});

	it('loads a graph instead of an error', async () => {
		repo = await createTempRepo();

		const reply = await loadCommits(contextFor(repo.cwd), 50);

		expect(reply.type).toBe('commits');
		expect(reply.type === 'commits' && reply.isUnborn).toBe(true);
		expect(reply.type === 'commits' && reply.currentBranch).toBe('main');
		expect(reply.type === 'commits' && reply.headHash).toBeNull();
	});

	it('loads a status update instead of an error', async () => {
		repo = await createTempRepo();

		const reply = await loadStatus(contextFor(repo.cwd));

		expect(reply.type).toBe('statusUpdate');
		expect(reply.type === 'statusUpdate' && reply.isUnborn).toBe(true);
		expect(reply.type === 'statusUpdate' && reply.currentBranch).toBe('main');
	});

	it('names the branch, where rev-parse alone cannot', async () => {
		repo = await createTempRepo();

		await expect(executor.run(['rev-parse', '--abbrev-ref', 'HEAD'], repo.cwd)).rejects.toThrow();
		expect(await getCurrentBranch(executor, repo.cwd)).toBe('main');
	});

	it('stops being unborn once the first commit lands, and the commit shows', async () => {
		repo = await createTempRepo();
		await repo.commit('a.txt', 'hello\n', 'first');

		const reply = await loadCommits(contextFor(repo.cwd), 50);

		expect(reply.type === 'commits' && reply.isUnborn).toBe(false);
		expect(reply.type === 'commits' && reply.currentBranch).toBe('main');
		expect(reply.type === 'commits' && reply.commits.map((c) => c.subject)).toContain('first');
	});

	it('still reports a real detached HEAD as detached', async () => {
		repo = await createTempRepo();
		await repo.commit('a.txt', 'one\n', 'first');
		await repo.commit('b.txt', 'two\n', 'second');
		await repo.git('checkout', '--detach', 'HEAD~1');

		const reply = await loadCommits(contextFor(repo.cwd), 50);

		expect(reply.type === 'commits' && reply.isUnborn).toBe(false);
		expect(reply.type === 'commits' && reply.currentBranch).toBeNull();
	});

	it('keeps a commit no branch reaches, which is what HEAD in the walk is for', async () => {
		repo = await createTempRepo();
		await repo.commit('a.txt', 'one\n', 'first');
		await repo.git('checkout', '--detach', 'HEAD');
		await repo.commit('b.txt', 'two\n', 'only on the detached head');

		const reply = await loadCommits(contextFor(repo.cwd), 50);

		const listSubjects = reply.type === 'commits' ? reply.commits.map((c) => c.subject) : [];
		expect(listSubjects).toContain('only on the detached head');
	});
});
