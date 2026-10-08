import { describe, expect, it } from 'vitest';
import {
	busyLockPath,
	retriesOnLock,
	skipsOptionalLocks,
	subcommandOf,
	writesIndex,
} from './indexLock';

describe('subcommandOf', () => {
	it('looks past the global options the sequencer puts in front', () => {
		expect(subcommandOf(['-c', 'core.editor=true', 'rebase', '--continue'])).toBe('rebase');
		expect(subcommandOf(['-c', 'core.quotePath=false', 'diff', 'HEAD'])).toBe('diff');
	});

	it('reads a plain command', () => {
		expect(subcommandOf(['status', '--porcelain=v2'])).toBe('status');
	});

	it('has nothing to name when there is no subcommand', () => {
		expect(subcommandOf([])).toBeUndefined();
		expect(subcommandOf(['--version'])).toBeUndefined();
	});
});

describe('writesIndex', () => {
	// The exact argv forms this codebase builds, classified by holding .git/index.lock and running
	// each one (feature 075 §1.1) — not by reading the names.
	it.each([
		['add', ['add', '-A']],
		['add with pathspec', ['add', '--', 'src/a.ts']],
		['reset', ['reset', '-q', 'HEAD']],
		['reset hard', ['reset', '--hard', 'origin/main']],
		['commit', ['commit', '-m', 'x']],
		['amend', ['commit', '--amend', '--no-edit']],
		['checkout a path', ['checkout', 'HEAD', '--', 'a.ts']],
		['checkout detached', ['checkout', '--detach', 'abc123']],
		['rm cached', ['rm', '--cached', '--', 'a.ts']],
		['stash push', ['stash', 'push', '--include-untracked']],
		['bare stash', ['stash']],
		['cherry-pick', ['cherry-pick', 'abc']],
		['revert', ['revert', '--no-edit', 'abc']],
		['rebase', ['rebase', '--onto', 'a', 'b', 'c']],
		['sequencer continue', ['-c', 'core.editor=true', 'rebase', '--continue']],
		['merge', ['merge', '--no-edit', 'origin/main']],
		['pull', ['pull', '--ff-only']],
	])('serializes %s', (_label, args) => {
		expect(writesIndex(args)).toBe(true);
	});

	it.each([
		['log', ['log', '--decorate=full', '-n', '50']],
		['stash list', ['stash', 'list', '--pretty=format:%H']],
		['merge-base', ['merge-base', '--is-ancestor', 'a', 'b']],
		['status', ['status', '--porcelain=v2', '-z', '--branch']],
		['diff', ['diff', 'HEAD', '--numstat']],
		['clean', ['clean', '-fd', '--', 'a.ts']],
		['branch delete', ['branch', '-d', 'feature/x']],
		['for-each-ref', ['for-each-ref', 'refs/heads']],
		['rev-parse', ['rev-parse', 'HEAD']],
		['fetch', ['fetch', '--all', '--prune']],
		['push', ['push', '--force-with-lease']],
		['check-ignore', ['check-ignore', '--', 'a.ts']],
		['config', ['config', '--local', 'user.name', 'x']],
		['update-ref', ['update-ref', 'refs/heads/x', 'abc']],
	])('leaves %s free to run in parallel', (_label, args) => {
		expect(writesIndex(args)).toBe(false);
	});

	it('treats clean as a non-writer even though it deletes files', () => {
		// Measured: `clean` never takes index.lock. It matters because WorkingTreeService reaches for
		// it in the catch of a checkout, and that catch must not assume a lock failure.
		expect(writesIndex(['clean', '-fd', '--', 'a.ts'])).toBe(false);
	});
});

describe('skipsOptionalLocks', () => {
	it('turns the optional refresh off for status', () => {
		expect(skipsOptionalLocks(['status', '--porcelain=v2', '-z', '--branch'])).toBe(true);
		expect(skipsOptionalLocks(['status', '--porcelain', '--untracked-files=no'])).toBe(true);
	});

	it('leaves diff alone, because diff ignores the variable anyway', () => {
		// Measured on git 2.50.1: `GIT_OPTIONAL_LOCKS=0 git diff HEAD --numstat` still rewrites the
		// index. Setting it there would buy nothing and only make the claim in the comment false.
		expect(skipsOptionalLocks(['diff', 'HEAD', '--numstat'])).toBe(false);
	});

	it('never touches a write command', () => {
		expect(skipsOptionalLocks(['commit', '-m', 'x'])).toBe(false);
		expect(skipsOptionalLocks(['add', '-A'])).toBe(false);
	});
});

describe('retriesOnLock', () => {
	it.each([
		['add', '--', 'a.ts'],
		['commit', '--amend', '--only', '--allow-empty', '-m', 'x'],
		['reset', '--hard', 'abc'],
		['checkout', '--track', '-b', 'x', 'origin/x'],
		['restore', '--staged', 'a.ts'],
		['switch', '-c', 'x'],
		['rm', '--cached', 'a.ts'],
		['mv', 'a.ts', 'b.ts'],
	])('retries %s — it dies before changing anything when the lock is held', (...args) => {
		expect(retriesOnLock(args)).toBe(true);
	});

	it.each([
		['rebase', 'main'],
		['merge', 'x'],
		['pull'],
		['cherry-pick', 'abc'],
		['revert', 'abc'],
		['am'],
		['stash', 'push'],
		['stash', 'pop'],
	])('never retries %s — it can fail after it has changed something', (...args) => {
		expect(retriesOnLock(args)).toBe(false);
	});

	it('never retries a read', () => {
		expect(retriesOnLock(['status', '--porcelain'])).toBe(false);
		expect(retriesOnLock(['diff-index', '-p', 'HEAD'])).toBe(false);
	});
});

describe('busyLockPath', () => {
	it("names the lock from git's wording, spaces in the path included", () => {
		expect(
			busyLockPath(
				"fatal: Unable to create '/Users/me/My Repo/.git/index.lock': File exists.\n\nAnother git"
			)
		).toBe('/Users/me/My Repo/.git/index.lock');
	});

	it("is null for every other failure, stash's differently worded one included", () => {
		expect(busyLockPath('error: could not write index')).toBeNull();
		expect(busyLockPath('fatal: not a git repository')).toBeNull();
	});
});
