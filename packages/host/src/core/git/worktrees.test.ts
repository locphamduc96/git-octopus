import { describe, expect, it } from 'vitest';
import { defaultWorktreePath, parseWorktrees } from './worktrees.js';

const PORCELAIN = [
	'worktree /repo',
	'HEAD 1111111111111111111111111111111111111111',
	'branch refs/heads/main',
	'',
	'worktree /repo-feature',
	'HEAD 2222222222222222222222222222222222222222',
	'branch refs/heads/feature/x',
	'locked',
	'',
	'worktree /gone',
	'HEAD 3333333333333333333333333333333333333333',
	'detached',
	'prunable gitdir file points to non-existent location',
	'',
].join('\n');

describe('parseWorktrees', () => {
	it('reads each block, the main worktree first, and marks the one this window has open', () => {
		expect(parseWorktrees(PORCELAIN, '/repo-feature')).toEqual([
			{
				path: '/repo',
				head: '1'.repeat(40),
				branch: 'main',
				isMain: true,
				isCurrent: false,
				locked: false,
				prunable: false,
			},
			{
				path: '/repo-feature',
				head: '2'.repeat(40),
				branch: 'feature/x',
				isMain: false,
				isCurrent: true,
				locked: true,
				prunable: false,
			},
			{
				path: '/gone',
				head: '3'.repeat(40),
				branch: null,
				isMain: false,
				isCurrent: false,
				locked: false,
				prunable: true,
			},
		]);
	});

	it('reads a bare main entry as having no HEAD and no branch', () => {
		expect(parseWorktrees('worktree /bare.git\nbare\n', null)).toMatchObject([
			{ path: '/bare.git', head: null, branch: null, isMain: true },
		]);
	});
});

describe('defaultWorktreePath', () => {
	it('puts the worktree beside the repository, named after both, slashes flattened', () => {
		expect(defaultWorktreePath('/code/app', 'feature/login')).toBe('/code/app-feature-login');
	});
});
