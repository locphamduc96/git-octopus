import { describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import { identityMismatch, matchIdentity, remoteHost, suggestIdentity } from './identity';

const work: GitIdentity = {
	label: 'Work',
	name: 'Loc Pham',
	email: 'locpd2@vng.com.vn',
	hostPattern: 'gitlab.vng.vn',
};
const personal: GitIdentity = {
	label: 'Personal',
	name: 'locpham',
	email: 'locphamduc96@gmail.com',
	hostPattern: 'github.com/locphamduc96',
};
const noPattern: GitIdentity = { label: 'Other', name: 'x', email: 'x@example.com' };

describe('matchIdentity', () => {
	it('finds the identity in use by email', () => {
		expect(matchIdentity([work, personal], 'locphamduc96@gmail.com')).toBe(personal);
	});

	it('returns null when the email is unset or unknown', () => {
		expect(matchIdentity([work, personal], null)).toBeNull();
		expect(matchIdentity([work, personal], 'someone@else.dev')).toBeNull();
	});
});

describe('suggestIdentity', () => {
	it('suggests the identity whose pattern appears in a remote URL', () => {
		const listUrls = ['git@gitlab.vng.vn:team/app.git'];
		expect(suggestIdentity([personal, work], listUrls)).toBe(work);
	});

	it('ignores identities without a pattern and repos without a match', () => {
		expect(suggestIdentity([noPattern, work], ['https://example.com/repo.git'])).toBeNull();
		expect(suggestIdentity([noPattern], ['https://example.com/repo.git'])).toBeNull();
	});
});

describe('identityMismatch', () => {
	const listUrls = ['https://github.com/locphamduc96/git-octopus.git'];

	it('warns when the repo suggests a different identity than the one in use', () => {
		expect(identityMismatch([work, personal], listUrls, 'locpd2@vng.com.vn')).toBe(personal);
	});

	it('stays quiet when the suggested identity is already in use', () => {
		expect(identityMismatch([work, personal], listUrls, 'locphamduc96@gmail.com')).toBeNull();
	});

	it('stays quiet when nothing is suggested', () => {
		expect(identityMismatch([work, personal], ['https://example.com/x.git'], null)).toBeNull();
	});
});

describe('remoteHost', () => {
	it('reads the host out of an https remote', () => {
		expect(remoteHost('https://zalogit2.zing.vn/zalogame/game/ChineseChess')).toBe(
			'zalogit2.zing.vn'
		);
	});

	it('reads the host out of an scp-style remote', () => {
		expect(remoteHost('git@github.com:locphamduc96/git-octopus.git')).toBe('github.com');
	});

	it('keeps the port out of the way of a plain host match', () => {
		expect(remoteHost('ssh://git@git.example.com:2222/team/repo.git')).toBe('git.example.com:2222');
	});

	it('returns null for something that is not a URL', () => {
		expect(remoteHost('../sibling-repo')).toBeNull();
	});
});
