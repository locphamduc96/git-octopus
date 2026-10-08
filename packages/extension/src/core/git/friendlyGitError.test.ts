import { describe, expect, it } from 'vitest';
import { friendlyGitError, friendlyGitErrorDetail } from './friendlyGitError';

describe('friendlyGitError', () => {
	it('explains missing stored credentials', () => {
		expect(
			friendlyGitError(
				"fatal: could not read Username for 'https://zalogit2.zing.vn': terminal prompts disabled"
			)
		).toMatch(/sign in|credential helper/);
	});

	it('points authentication failures at tokens', () => {
		expect(friendlyGitError('remote: Authentication failed for user x')).toMatch(/access token/);
	});

	it('points publickey rejections at the agent', () => {
		expect(friendlyGitError('git@host: Permission denied (publickey).')).toMatch(/ssh-agent/);
	});

	it('never advises deleting known_hosts', () => {
		const message = friendlyGitError('Host key verification failed.');
		expect(message).toMatch(/fingerprint/);
		expect(message).not.toMatch(/known_hosts/);
	});

	it('returns null for everything else', () => {
		expect(friendlyGitError('fatal: not a git repository')).toBeNull();
	});

	it('explains a repository that has no commits yet, in both phrasings git uses', () => {
		expect(
			friendlyGitError("fatal: your current branch 'main' does not have any commits yet")
		).toContain('no commits yet');
		expect(friendlyGitError('You do not have the initial commit yet')).toContain('no commits yet');
	});
});

describe('friendlyGitErrorDetail', () => {
	const LOCK_FATAL =
		"fatal: Unable to create '/Users/me/work/repo/.git/index.lock': File exists.\n" +
		'Another git process seems to be running in this repository';

	it('names the lock file the failure pointed at', () => {
		const detail = friendlyGitErrorDetail(LOCK_FATAL, '/Users/me/work/repo');
		expect(detail?.action).toEqual({
			id: 'removeStaleLock',
			lockPath: '/Users/me/work/repo/.git/index.lock',
		});
		expect(detail?.message).not.toContain('seems to be running');
	});

	it('reads a path with spaces in it', () => {
		const detail = friendlyGitErrorDetail(
			"fatal: Unable to create '/Users/me/My Work/repo/.git/index.lock': File exists.",
			'/Users/me/My Work/repo'
		);
		expect(detail?.action?.lockPath).toBe('/Users/me/My Work/repo/.git/index.lock');
	});

	it('recognises the different wording git uses for stash, which names no path', () => {
		// `git stash push` exits 1 with only "error: could not write index" — matching the
		// "index.lock: File exists" text alone would miss it entirely.
		const detail = friendlyGitErrorDetail('error: could not write index', '/repo');
		expect(detail?.action).toEqual({ id: 'removeStaleLock', lockPath: '/repo/.git/index.lock' });
	});

	it('offers no remedy for the stash wording when it does not know the repository', () => {
		expect(friendlyGitErrorDetail('error: could not write index')).toBeNull();
	});

	it('still carries the plain explanations, without an action', () => {
		const detail = friendlyGitErrorDetail('remote: Authentication failed for user x');
		expect(detail?.message).toMatch(/access token/);
		expect(detail?.action).toBeUndefined();
	});

	it('returns null for everything else', () => {
		expect(friendlyGitErrorDetail('fatal: not a git repository', '/repo')).toBeNull();
	});
});
