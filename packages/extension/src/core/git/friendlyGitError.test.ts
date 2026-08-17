import { describe, expect, it } from 'vitest';
import { friendlyGitError } from './friendlyGitError';

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
});
