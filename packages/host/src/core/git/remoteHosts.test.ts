import { describe, expect, it } from 'vitest';
import { hostOfRemoteUrl, parseRemoteHosts } from './remoteHosts';

describe('hostOfRemoteUrl', () => {
	it('parses the common URL shapes', () => {
		expect(hostOfRemoteUrl('https://github.com/o/r.git')).toBe('github.com');
		expect(hostOfRemoteUrl('https://user@zalogit2.zing.vn/t/r.git')).toBe('zalogit2.zing.vn');
		expect(hostOfRemoteUrl('ssh://git@github.com:443/o/r.git')).toBe('github.com');
		expect(hostOfRemoteUrl('git@github.com:o/r.git')).toBe('github.com');
	});

	it('does not mistake userinfo tricks for the host', () => {
		expect(hostOfRemoteUrl('https://github.com@evil.tld/o/r.git')).toBe('evil.tld');
	});
});

describe('parseRemoteHosts', () => {
	it('collects unique hosts from git remote -v output', () => {
		const output = [
			'origin\thttps://zalogit2.zing.vn/team/repo.git (fetch)',
			'origin\thttps://zalogit2.zing.vn/team/repo.git (push)',
			'gh\tgit@github.com:me/repo.git (fetch)',
			'gh\tgit@github.com:me/repo.git (push)',
		].join('\n');
		expect(parseRemoteHosts(output).sort()).toEqual(['github.com', 'zalogit2.zing.vn']);
	});

	it('returns empty for a repo without remotes', () => {
		expect(parseRemoteHosts('')).toEqual([]);
	});
});
