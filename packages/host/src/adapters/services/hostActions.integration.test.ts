import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RebaseStep, SelectedDiffLine, StageLinesMessage } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { GitProcessExecutor } from '../process/gitProcessExecutor.js';
import { createTempRepo, type TempRepo } from '../../test/tempRepo.js';
import { resetRecorded, testShell } from '../../test/fakeShell.js';
import { WorkingTreeService } from './WorkingTreeService.js';
import { RepoActionService } from './RepoActionService.js';
import { CommitActionService } from './CommitActionService.js';
import { UndoService } from './UndoService.js';
import { InteractiveRebaseService } from './InteractiveRebaseService.js';
import { HistoryRewriter } from './HistoryRewriter.js';
import { WorktreeService } from './WorktreeService.js';
import { getWorktrees } from '../../core/git/worktrees.js';
import { getCommitDetails } from '../../core/git/gitService.js';
import { recorded } from '../../test/fakeShell.js';

const YES: UserPrompt = {
	confirm: () => Promise.resolve(true),
	pickOptions: (request) => Promise.resolve(request.listOptions.map((option) => option.id)),
	inputText: () => Promise.resolve(undefined),
};

const add = (newLine: number, text: string): SelectedDiffLine => ({
	kind: 'add',
	oldLine: null,
	newLine,
	text,
});
const del = (oldLine: number, text: string): SelectedDiffLine => ({
	kind: 'del',
	oldLine,
	newLine: null,
	text,
});

/** Lines picked in the view, against a real repository and a real `git apply`. */
describe('WorkingTreeService.stageLines against a real repository', () => {
	let repo: TempRepo;
	const service = new WorkingTreeService(new GitProcessExecutor(), testShell);
	const request = (
		action: StageLinesMessage['action'],
		listLines: SelectedDiffLine[],
		file = 'f.txt'
	): StageLinesMessage => ({
		type: 'stageLines',
		repoPath: repo.cwd,
		path: file,
		side: action === 'unstage' ? 'staged' : 'unstaged',
		action,
		listLines,
	});

	beforeEach(async () => {
		resetRecorded();
		repo = await createTempRepo();
		await repo.commit('f.txt', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 'base');
		// Two changes far enough apart to be two hunks: b → B and i → I.
		await writeFile(path.join(repo.cwd, 'f.txt'), 'a\nB\nc\nd\ne\nf\ng\nh\nI\nj\n');
	});

	afterEach(async () => {
		await repo.dispose();
	});

	it('stages one change and leaves the other unstaged', async () => {
		expect(
			await service.stageLines(request('stage', [del(2, 'b'), add(2, 'B')]), repo.cwd, YES)
		).toBe(true);

		const staged = await repo.git('diff', '--cached', '--', 'f.txt');
		expect(staged).toContain('-b\n+B');
		expect(staged).not.toContain('+I');
		const unstaged = await repo.git('diff', '--', 'f.txt');
		expect(unstaged).toContain('-i\n+I');
		expect(unstaged).not.toContain('+B');
	});

	it('stages an added line without its replaced line, keeping the old one in the index', async () => {
		expect(await service.stageLines(request('stage', [add(2, 'B')]), repo.cwd, YES)).toBe(true);
		const index = await repo.git('show', ':f.txt');
		expect(index.split('\n').slice(0, 3)).toEqual(['a', 'b', 'B']);
	});

	it('unstages a staged change back out of the index, leaving the disk alone', async () => {
		await repo.git('add', 'f.txt');
		expect(
			await service.stageLines(request('unstage', [del(9, 'i'), add(9, 'I')]), repo.cwd, YES)
		).toBe(true);

		expect(await repo.git('diff', '--cached', '--', 'f.txt')).not.toContain('+I');
		expect(await repo.git('diff', '--cached', '--', 'f.txt')).toContain('+B');
		expect(await readFile(path.join(repo.cwd, 'f.txt'), 'utf8')).toContain('I\n');
	});

	it('discards one change from the working tree and keeps the other', async () => {
		expect(
			await service.stageLines(request('discard', [del(9, 'i'), add(9, 'I')]), repo.cwd, YES)
		).toBe(true);
		expect(await readFile(path.join(repo.cwd, 'f.txt'), 'utf8')).toBe(
			'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n'
		);
	});

	it('does nothing when a discard is not confirmed', async () => {
		const NO: UserPrompt = { ...YES, confirm: () => Promise.resolve(false) };
		expect(await service.stageLines(request('discard', [add(9, 'I')]), repo.cwd, NO)).toBe(false);
		expect(await readFile(path.join(repo.cwd, 'f.txt'), 'utf8')).toContain('I\n');
	});

	it('refuses lines that no longer match the file, and changes nothing', async () => {
		expect(await service.stageLines(request('stage', [add(2, 'X')]), repo.cwd, YES)).toBe(false);
		expect((await repo.git('diff', '--cached')).trim()).toBe('');
	});

	it('handles a file whose last line has no newline', async () => {
		await repo.commit('n.txt', 'one\ntwo', 'no newline at the end');
		await writeFile(path.join(repo.cwd, 'n.txt'), 'one\nTWO');
		expect(
			await service.stageLines(
				request('stage', [del(2, 'two'), add(2, 'TWO')], 'n.txt'),
				repo.cwd,
				YES
			)
		).toBe(true);
		expect(await repo.git('show', ':n.txt')).toBe('one\nTWO');
	});

	it('refuses a side that does not fit the action', async () => {
		const wrong: StageLinesMessage = { ...request('stage', [add(2, 'B')]), side: 'staged' };
		expect(await service.stageLines(wrong, repo.cwd, YES)).toBe(false);
	});
});

describe('WorkingTreeService stashFile against a real repository', () => {
	it('puts one file away and leaves the other change where it is', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'a');
			await repo.commit('b.txt', 'b\n', 'b');
			await writeFile(path.join(repo.cwd, 'a.txt'), 'A\n');
			await writeFile(path.join(repo.cwd, 'b.txt'), 'B\n');
			await writeFile(path.join(repo.cwd, 'new.txt'), 'new\n');
			const named: UserPrompt = { ...YES, inputText: () => Promise.resolve('just a') };
			const service = new WorkingTreeService(new GitProcessExecutor(), testShell);
			const stash = (file: string) =>
				service.run(
					{ type: 'workingTreeAction', repoPath: repo.cwd, action: 'stashFile', path: file },
					repo.cwd,
					named
				);

			expect(await stash('a.txt')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'a.txt'), 'utf8')).toBe('a\n');
			expect(await readFile(path.join(repo.cwd, 'b.txt'), 'utf8')).toBe('B\n');
			expect(await repo.git('stash', 'list')).toContain('just a');

			// An untracked file can be put away too.
			expect(await stash('new.txt')).toBe(true);
			expect(await repo.git('status', '--porcelain')).not.toContain('new.txt');
		} finally {
			await repo.dispose();
		}
	});
});

describe('RepoActionService remotes against a real repository', () => {
	it('adds and fetches a remote, then removes it with its tracking branches', async () => {
		const upstream = await createTempRepo();
		const clone = await createTempRepo();
		try {
			await upstream.commit('u.txt', 'u\n', 'upstream work');
			await clone.commit('c.txt', 'c\n', 'local work');
			const service = new RepoActionService(new GitProcessExecutor(), testShell);
			const add = await service.runRemoteAction(
				{
					type: 'remoteAction',
					repoPath: clone.cwd,
					action: 'add',
					name: 'team',
					url: upstream.cwd,
				},
				clone.cwd,
				YES
			);
			expect(add).toBe(true);
			expect((await clone.git('rev-parse', 'refs/remotes/team/main')).trim()).toBe(
				(await upstream.git('rev-parse', 'main')).trim()
			);

			await clone.git('branch', '--set-upstream-to=team/main', 'main');
			expect((await clone.git('rev-parse', '--abbrev-ref', 'main@{u}')).trim()).toBe('team/main');

			const removed = await service.runRemoteAction(
				{ type: 'remoteAction', repoPath: clone.cwd, action: 'remove', name: 'team' },
				clone.cwd,
				YES
			);
			expect(removed).toBe(true);
			expect((await clone.git('branch', '-r')).trim()).toBe('');
		} finally {
			await upstream.dispose();
			await clone.dispose();
		}
	});
});

describe('CommitActionService drop reset against a real repository', () => {
	it('moves a branch that is not checked out to the dropped one, leaving the files alone', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('a.txt', 'a\n', 'base');
			await repo.git('branch', 'other');
			const tip = await repo.commit('a.txt', 'b\n', 'ahead on main');
			await writeFile(path.join(repo.cwd, 'a.txt'), 'dirty\n');
			const service = new CommitActionService(new GitProcessExecutor(), testShell, () => null);
			const moved = await service.runBranchAction(
				{
					type: 'branchAction',
					repoPath: repo.cwd,
					action: 'resetTo',
					source: 'main',
					sourceLabel: 'main',
					target: 'other',
				},
				repo.cwd,
				YES
			);
			expect(moved).toBe(true);
			expect((await repo.git('rev-parse', 'other')).trim()).toBe(tip);
			expect(await readFile(path.join(repo.cwd, 'a.txt'), 'utf8')).toBe('dirty\n');
		} finally {
			await repo.dispose();
		}
	});
});

describe('CommitActionService cherry-pick list against a real repository', () => {
	async function sideBranch() {
		const repo = await createTempRepo();
		await repo.commit('base.txt', 'base\n', 'base');
		await repo.git('checkout', '-b', 'side');
		const one = await repo.commit('one.txt', '1\n', 'one');
		const two = await repo.commit('two.txt', '2\n', 'two');
		const three = await repo.commit('three.txt', '3\n', 'three');
		await repo.git('checkout', 'main');
		const service = new CommitActionService(new GitProcessExecutor(), testShell, () => null);
		const pick = (listHashes: string[], recordOrigin: boolean, noCommit: boolean) =>
			service.cherryPickList(
				{ type: 'cherryPickCommits', repoPath: repo.cwd, listHashes, recordOrigin, noCommit },
				repo.cwd
			);
		return { repo, one, two, three, pick };
	}

	it('picks the commits in the order given, noting where each came from', async () => {
		const { repo, one, three, pick } = await sideBranch();
		try {
			expect(await pick([three, one], true, false)).toBe(true);
			expect((await repo.git('log', '-2', '--format=%s')).trim().split('\n')).toEqual([
				'one',
				'three',
			]);
			expect(await repo.git('log', '-1', '--format=%B')).toContain(
				`(cherry picked from commit ${one})`
			);
		} finally {
			await repo.dispose();
		}
	});

	it('stages the changes without committing when asked', async () => {
		const { repo, one, two, pick } = await sideBranch();
		try {
			const before = (await repo.git('rev-parse', 'HEAD')).trim();
			expect(await pick([one, two], false, true)).toBe(true);
			expect((await repo.git('rev-parse', 'HEAD')).trim()).toBe(before);
			expect((await repo.git('diff', '--cached', '--name-only')).trim().split('\n')).toEqual([
				'one.txt',
				'two.txt',
			]);
		} finally {
			await repo.dispose();
		}
	});

	it('refuses a hash that is not a commit here', async () => {
		const { repo, pick } = await sideBranch();
		try {
			const before = (await repo.git('rev-parse', 'HEAD')).trim();
			expect(await pick(['0123456789abcdef0123456789abcdef01234567'], false, false)).toBe(false);
			expect((await repo.git('rev-parse', 'HEAD')).trim()).toBe(before);
		} finally {
			await repo.dispose();
		}
	});
});

describe('UndoService redo against a real repository', () => {
	it('undoes a branch created and checked out, then redoes it', async () => {
		const repo = await createTempRepo();
		try {
			const base = await repo.commit('a.txt', 'a\n', 'base');
			const executor = new GitProcessExecutor();
			const undo = new UndoService(executor, testShell);
			await undo.record('create feature', repo.cwd, async () => {
				await executor.run(['checkout', '-b', 'feature'], repo.cwd);
				return true;
			});

			expect(await undo.run(repo.cwd)).toBe(true);
			expect((await repo.git('symbolic-ref', '--short', 'HEAD')).trim()).toBe('main');
			expect(await repo.git('branch', '--list', 'feature')).toBe('');

			expect(await undo.redo(repo.cwd)).toBe(true);
			expect((await repo.git('symbolic-ref', '--short', 'HEAD')).trim()).toBe('feature');
			expect((await repo.git('rev-parse', 'feature')).trim()).toBe(base);
		} finally {
			await repo.dispose();
		}
	});
});

describe('WorkingTreeService conflict resolution against a real repository', () => {
	it('takes one side of a conflicted file, staged, and can put the markers back', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('c.txt', 'base\n', 'base');
			await repo.git('checkout', '-b', 'other');
			await repo.commit('c.txt', 'theirs\n', 'their change');
			await repo.git('checkout', 'main');
			await repo.commit('c.txt', 'ours\n', 'our change');
			await repo.git('merge', 'other').catch(() => '');
			expect(await repo.git('status', '--porcelain')).toContain('UU c.txt');

			const service = new WorkingTreeService(new GitProcessExecutor(), testShell);
			const act = (action: 'takeOurs' | 'takeTheirs' | 'restoreConflict') =>
				service.run(
					{ type: 'workingTreeAction', repoPath: repo.cwd, action, path: 'c.txt' },
					repo.cwd,
					YES
				);

			expect(await act('takeOurs')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'c.txt'), 'utf8')).toBe('ours\n');
			// Resolved: no longer unmerged. Ours is HEAD's own content, so nothing is left to show.
			expect(await repo.git('status', '--porcelain')).not.toContain('UU');

			// Restoring the markers needs the conflict back in the index.
			await repo.git('update-index', '--unresolve', 'c.txt');
			expect(await act('restoreConflict')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'c.txt'), 'utf8')).toContain('<<<<<<<');

			expect(await act('takeTheirs')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'c.txt'), 'utf8')).toBe('theirs\n');
		} finally {
			await repo.dispose();
		}
	});
});

describe('InteractiveRebaseService against a real repository', () => {
	async function threeCommits() {
		const repo = await createTempRepo();
		const base = await repo.commit('base.txt', 'base\n', 'base');
		const one = await repo.commit('one.txt', '1\n', 'one');
		const two = await repo.commit('two.txt', '2\n', 'two');
		const three = await repo.commit('three.txt', '3\n', 'three');
		const executor = new GitProcessExecutor();
		const service = new InteractiveRebaseService(
			executor,
			testShell,
			new HistoryRewriter(executor, testShell)
		);
		const subjects = async () =>
			(await repo.git('log', '--format=%s', `${base}..HEAD`)).trim().split('\n').reverse();
		const run = (listSteps: RebaseStep[]) =>
			service.run({ type: 'interactiveRebase', repoPath: repo.cwd, base, listSteps }, repo.cwd);
		return { repo, base, one, two, three, service, subjects, run };
	}

	it('lists the commits after the base, oldest first, with full messages', async () => {
		const { repo, base, service } = await threeCommits();
		try {
			const todo = await service.load(base, repo.cwd);
			expect(todo.listCommits.map((commit) => commit.subject)).toEqual(['one', 'two', 'three']);
		} finally {
			await repo.dispose();
		}
	});

	it('reorders, squashes and drops in one run', async () => {
		const { repo, one, two, three, subjects, run } = await threeCommits();
		try {
			expect(
				await run([
					{ hash: three, action: 'pick' },
					{ hash: one, action: 'fixup' },
					{ hash: two, action: 'drop' },
				])
			).toBe(true);
			expect(await subjects()).toEqual(['three']);
			const files = (await repo.git('ls-files')).trim().split('\n').sort();
			expect(files).toEqual(['base.txt', 'one.txt', 'three.txt']);
		} finally {
			await repo.dispose();
		}
	});

	it('rewords with a message sh and printf would otherwise mangle', async () => {
		const { repo, one, two, three, run } = await threeCommits();
		const message = "-x it's 100% done\\path\n\nsecond paragraph";
		try {
			await run([
				{ hash: one, action: 'pick' },
				{ hash: two, action: 'reword', message },
				{ hash: three, action: 'pick' },
			]);
			expect((await repo.git('log', '-1', '--format=%B', 'HEAD~1')).trim()).toBe(message);
			expect((await repo.git('log', '-1', '--format=%s')).trim()).toBe('three');
		} finally {
			await repo.dispose();
		}
	});

	it('stops on a conflict with the rebase left to continue', async () => {
		const repo = await createTempRepo();
		try {
			const base = await repo.commit('c.txt', 'a\n', 'base');
			const first = await repo.commit('c.txt', 'b\n', 'first');
			const second = await repo.commit('c.txt', 'c\n', 'second');
			const executor = new GitProcessExecutor();
			const service = new InteractiveRebaseService(
				executor,
				testShell,
				new HistoryRewriter(executor, testShell)
			);
			expect(
				await service.run(
					{
						type: 'interactiveRebase',
						repoPath: repo.cwd,
						base,
						listSteps: [
							{ hash: second, action: 'pick' },
							{ hash: first, action: 'pick' },
						],
					},
					repo.cwd
				)
			).toBe(true);
			expect((await repo.git('ls-files', '--unmerged')).trim()).not.toBe('');
			await repo.git('rebase', '--abort');
		} finally {
			await repo.dispose();
		}
	});

	it('moves another branch onto a base, its commits in the new order', async () => {
		const repo = await createTempRepo();
		try {
			const base = await repo.commit('base.txt', 'base\n', 'base');
			await repo.git('checkout', '-b', 'feature');
			const a1 = await repo.commit('a1.txt', '1\n', 'a1');
			const a2 = await repo.commit('a2.txt', '2\n', 'a2');
			await repo.git('checkout', 'main');
			const onMain = await repo.commit('m.txt', 'm\n', 'main moved on');
			const executor = new GitProcessExecutor();
			const service = new InteractiveRebaseService(
				executor,
				testShell,
				new HistoryRewriter(executor, testShell)
			);

			const todo = await service.load('refs/heads/main', repo.cwd, 'feature');
			expect(todo.branch).toBe('feature');
			expect(todo.listCommits.map((commit) => commit.hash)).toEqual([a1, a2]);
			expect(
				await service.run(
					{
						type: 'interactiveRebase',
						repoPath: repo.cwd,
						base: 'refs/heads/main',
						branch: 'feature',
						listSteps: [
							{ hash: a2, action: 'pick' },
							{ hash: a1, action: 'pick' },
						],
					},
					repo.cwd
				)
			).toBe(true);
			expect((await repo.git('symbolic-ref', '--short', 'HEAD')).trim()).toBe('feature');
			expect((await repo.git('log', '--format=%s', 'main..feature')).trim().split('\n')).toEqual([
				'a1',
				'a2',
			]);
			expect((await repo.git('merge-base', 'main', 'feature')).trim()).toBe(onMain);
			expect((await repo.git('rev-parse', 'main')).trim()).toBe(onMain);
			expect(base).not.toBe(onMain);
		} finally {
			await repo.dispose();
		}
	});

	it('refuses a branch to move that is not a local branch', async () => {
		const { repo, base, service } = await threeCommits();
		try {
			const todo = await service.load(base, repo.cwd, 'nope');
			expect(todo.error).toContain('not a local branch');
		} finally {
			await repo.dispose();
		}
	});

	it('refuses steps that no longer match the commits in the range', async () => {
		const { repo, one, two, run } = await threeCommits();
		try {
			const before = (await repo.git('rev-parse', 'HEAD')).trim();
			expect(
				await run([
					{ hash: one, action: 'pick' },
					{ hash: two, action: 'pick' },
				])
			).toBe(false);
			expect((await repo.git('rev-parse', 'HEAD')).trim()).toBe(before);
		} finally {
			await repo.dispose();
		}
	});
});

describe('WorktreeService against a real repository', () => {
	async function setUp() {
		const repo = await createTempRepo();
		await repo.commit('a.txt', 'a\n', 'base');
		await repo.git('branch', 'feature');
		const executor = new GitProcessExecutor();
		const service = new WorktreeService(executor, testShell);
		const top = (await repo.git('rev-parse', '--show-toplevel')).trim();
		const list = () => getWorktrees(executor, repo.cwd);
		return { repo, service, top, list };
	}

	it('adds a worktree for an existing branch and one for a new branch', async () => {
		const { repo, service, top, list } = await setUp();
		try {
			resetRecorded();
			const at = `${top}-wt-feature`;
			expect(
				await service.run(
					{
						type: 'worktreeAction',
						repoPath: repo.cwd,
						action: 'add',
						branch: 'feature',
						path: at,
					},
					repo.cwd,
					YES
				)
			).toBe(true);
			const fresh = `${top}-wt-fresh`;
			expect(
				await service.run(
					{
						type: 'worktreeAction',
						repoPath: repo.cwd,
						action: 'add',
						branch: 'fresh',
						path: fresh,
					},
					repo.cwd,
					YES
				)
			).toBe(true);
			const listWorktrees = await list();
			expect(listWorktrees.map((worktree) => worktree.branch)).toEqual([
				'main',
				'feature',
				'fresh',
			]);
			expect(listWorktrees[0]).toMatchObject({ isMain: true, isCurrent: true });
			for (const worktree of listWorktrees.slice(1)) {
				await repo.git('worktree', 'remove', '--force', worktree.path);
			}
		} finally {
			await repo.dispose();
		}
	});

	it('removes a clean worktree, asks again for a dirty one, and never removes the main one', async () => {
		const { repo, service, top, list } = await setUp();
		try {
			const at = `${top}-wt-dirty`;
			await repo.git('worktree', 'add', at, 'feature');
			await writeFile(path.join(at, 'a.txt'), 'dirty\n');
			let asked = 0;
			const yesTwice: UserPrompt = {
				...YES,
				confirm: () => {
					asked += 1;
					return Promise.resolve(true);
				},
			};
			const remove = (target: string) =>
				service.run(
					{ type: 'worktreeAction', repoPath: repo.cwd, action: 'remove', path: target },
					repo.cwd,
					yesTwice
				);
			expect(await remove(at)).toBe(true);
			expect(asked).toBe(2);
			expect((await list()).map((worktree) => worktree.path)).toEqual([top]);

			resetRecorded();
			expect(await remove(top)).toBe(false);
			expect(recorded.listErrors[0]).toContain('cannot be removed');
		} finally {
			await repo.dispose();
		}
	});

	it('opens only a listed worktree, in a new window', async () => {
		const { repo, service, top } = await setUp();
		try {
			resetRecorded();
			await service.run(
				{ type: 'worktreeAction', repoPath: repo.cwd, action: 'open', path: top },
				repo.cwd,
				YES
			);
			expect(recorded.listFolderWindows).toEqual([top]);
			await service.run(
				{ type: 'worktreeAction', repoPath: repo.cwd, action: 'open', path: '/not/a/worktree' },
				repo.cwd,
				YES
			);
			expect(recorded.listFolderWindows).toHaveLength(1);
		} finally {
			await repo.dispose();
		}
	});
});

describe('applying one file from a stash against a real repository', () => {
	async function stashed() {
		const repo = await createTempRepo();
		await repo.commit('a.txt', 'a\n', 'a');
		await repo.commit('b.txt', 'b\n', 'b');
		await writeFile(path.join(repo.cwd, 'a.txt'), 'a stashed\n');
		await writeFile(path.join(repo.cwd, 'b.txt'), 'b stashed\n');
		await writeFile(path.join(repo.cwd, 'new.txt'), 'new\n');
		await repo.git('stash', 'push', '--include-untracked', '-m', 'work');
		const stash = (await repo.git('rev-parse', 'stash@{0}')).trim();
		const executor = new GitProcessExecutor();
		const service = new WorkingTreeService(executor, testShell);
		const apply = (hash: string, file: string, prompt: UserPrompt = YES) =>
			service.run(
				{
					type: 'workingTreeAction',
					repoPath: repo.cwd,
					action: 'applyFromStash',
					hash,
					path: file,
				},
				repo.cwd,
				prompt
			);
		return { repo, stash, executor, apply };
	}

	it("lists a stash's untracked files from its third parent", async () => {
		const { repo, stash, executor } = await stashed();
		try {
			const details = await getCommitDetails(executor, repo.cwd, stash);
			expect(details.stash).toBe(true);
			const untracked = details.files.find((file) => file.path === 'new.txt');
			expect(untracked).toMatchObject({ status: '?' });
			expect(untracked?.revision).toBe((await repo.git('rev-parse', `${stash}^3`)).trim());
			expect(details.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt', 'new.txt']);
		} finally {
			await repo.dispose();
		}
	});

	it('takes one tracked file into the working tree, leaving the rest and the stash', async () => {
		const { repo, stash, apply } = await stashed();
		try {
			expect(await apply(stash, 'a.txt')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'a.txt'), 'utf8')).toBe('a stashed\n');
			expect(await readFile(path.join(repo.cwd, 'b.txt'), 'utf8')).toBe('b\n');
			expect((await repo.git('diff', '--cached', '--name-only')).trim()).toBe('');
			expect(await repo.git('stash', 'list')).toContain('work');
		} finally {
			await repo.dispose();
		}
	});

	it('brings back a file that was untracked when stashed', async () => {
		const { repo, stash, apply } = await stashed();
		try {
			const untrackedRoot = (await repo.git('rev-parse', `${stash}^3`)).trim();
			expect(await apply(untrackedRoot, 'new.txt')).toBe(true);
			expect(await readFile(path.join(repo.cwd, 'new.txt'), 'utf8')).toBe('new\n');
			expect(await repo.git('status', '--porcelain')).toContain('?? new.txt');
		} finally {
			await repo.dispose();
		}
	});

	it('asks before replacing a file that has changes of its own', async () => {
		const { repo, stash, apply } = await stashed();
		try {
			await writeFile(path.join(repo.cwd, 'a.txt'), 'mine\n');
			const refuse: UserPrompt = { ...YES, confirm: () => Promise.resolve(false) };
			expect(await apply(stash, 'a.txt', refuse)).toBe(false);
			expect(await readFile(path.join(repo.cwd, 'a.txt'), 'utf8')).toBe('mine\n');
		} finally {
			await repo.dispose();
		}
	});
});
