import { describe, expect, it } from 'vitest';
import { remoteCommitUrl } from './remoteUrl';

const HASH = 'abc123';

describe('remoteCommitUrl', () => {
	it('builds a GitHub commit URL from an https remote', () => {
		expect(remoteCommitUrl('https://github.com/owner/repo.git', HASH)).toBe(
			'https://github.com/owner/repo/commit/abc123'
		);
	});

	it('builds a GitHub commit URL from an scp-like ssh remote', () => {
		expect(remoteCommitUrl('git@github.com:owner/repo.git', HASH)).toBe(
			'https://github.com/owner/repo/commit/abc123'
		);
	});

	it('handles remotes without a .git suffix', () => {
		expect(remoteCommitUrl('https://github.com/owner/repo', HASH)).toBe(
			'https://github.com/owner/repo/commit/abc123'
		);
	});

	it('uses the GitLab path scheme, including self-hosted instances', () => {
		expect(remoteCommitUrl('git@gitlab.com:group/sub/repo.git', HASH)).toBe(
			'https://gitlab.com/group/sub/repo/-/commit/abc123'
		);
		expect(remoteCommitUrl('https://gitlab.mycompany.io/team/repo.git', HASH)).toBe(
			'https://gitlab.mycompany.io/team/repo/-/commit/abc123'
		);
	});

	it('uses the Bitbucket path scheme', () => {
		expect(remoteCommitUrl('https://bitbucket.org/owner/repo.git', HASH)).toBe(
			'https://bitbucket.org/owner/repo/commits/abc123'
		);
	});

	it('strips embedded credentials from https remotes', () => {
		expect(remoteCommitUrl('https://user:token@github.com/owner/repo.git', HASH)).toBe(
			'https://github.com/owner/repo/commit/abc123'
		);
	});

	it('handles full ssh:// remotes', () => {
		expect(remoteCommitUrl('ssh://git@github.com/owner/repo.git', HASH)).toBe(
			'https://github.com/owner/repo/commit/abc123'
		);
	});

	it('returns null for unrecognised hosts', () => {
		expect(remoteCommitUrl('https://git.internal.corp/owner/repo.git', HASH)).toBeNull();
		expect(remoteCommitUrl('/local/path/repo.git', HASH)).toBeNull();
	});
});
