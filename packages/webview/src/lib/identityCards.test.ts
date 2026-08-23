import { describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import { cardBadges, unsavedCurrentIdentity } from './identityCards';
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

describe('unsavedCurrentIdentity', () => {
	it('offers the effective identity when no saved card has its email', () => {
		expect(unsavedCurrentIdentity(repoIdentity(), [personal])).toEqual({
			name: 'locpd2',
			email: 'locpd2@vng.com.vn',
		});
	});

	it('stays quiet once a card with that email exists, even under another name', () => {
		const renamed: GitIdentity = { ...work, name: 'Loc P.D.' };
		expect(unsavedCurrentIdentity(repoIdentity(), [renamed])).toBeNull();
	});

	it('has nothing to offer without a repository identity', () => {
		expect(unsavedCurrentIdentity(null, [])).toBeNull();
	});

	it('has nothing to offer when the effective email is unset', () => {
		expect(unsavedCurrentIdentity(repoIdentity({ email: null }), [])).toBeNull();
	});

	it('fills an unset name with an empty string so the form can take it as-is', () => {
		expect(unsavedCurrentIdentity(repoIdentity({ name: null }), [])).toEqual({
			name: '',
			email: 'locpd2@vng.com.vn',
		});
	});
});
