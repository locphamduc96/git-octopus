import { describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import { cardBadges } from './identityCards';
import type { RepoIdentityState } from './viewSettings';

const work: GitIdentity = { label: 'Work', name: 'locpd2', email: 'locpd2@vng.com.vn' };
const personal: GitIdentity = { label: 'Personal', name: 'loc', email: 'loc@gmail.com' };

function repoIdentity(partial: Partial<RepoIdentityState> = {}): RepoIdentityState {
	return {
		name: 'locpd2',
		email: 'locpd2@vng.com.vn',
		hasLocalName: false,
		hasLocalEmail: false,
		listRemoteUrls: [],
		globalName: 'locpd2',
		globalEmail: 'locpd2@vng.com.vn',
		...partial,
	};
}

describe('cardBadges', () => {
	it('gives a duplicate of the global identity a note, not a second pill', () => {
		const badges = cardBadges(repoIdentity(), work, false);
		expect(badges).toEqual({ showInUse: false, applyDisabled: true, sameAsGlobal: true });
	});

	it('puts the pill on a saved identity only when it is the override in force', () => {
		const overriddenRepo = repoIdentity({
			name: 'loc',
			email: 'loc@gmail.com',
			hasLocalEmail: true,
		});
		expect(cardBadges(overriddenRepo, personal, true)).toEqual({
			showInUse: true,
			applyDisabled: true,
			sameAsGlobal: false,
		});
		// The other card matches neither the override nor... it *is* the global one: note only.
		expect(cardBadges(overriddenRepo, work, true)).toEqual({
			showInUse: false,
			applyDisabled: false,
			sameAsGlobal: true,
		});
	});

	it('leaves an unrelated identity plain and applicable', () => {
		expect(cardBadges(repoIdentity(), personal, false)).toEqual({
			showInUse: false,
			applyDisabled: false,
			sameAsGlobal: false,
		});
	});

	it('claims no duplicate when there is no global identity at all', () => {
		const noGlobal = repoIdentity({ globalName: null, globalEmail: null });
		expect(cardBadges(noGlobal, work, false).sameAsGlobal).toBe(false);
	});

	it('answers all-false without a repository identity', () => {
		expect(cardBadges(null, work, false)).toEqual({
			showInUse: false,
			applyDisabled: false,
			sameAsGlobal: false,
		});
	});
});
