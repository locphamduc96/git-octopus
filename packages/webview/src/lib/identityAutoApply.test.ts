import { describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import { planAutoApply } from './identityAutoApply';

const work: GitIdentity = { label: 'Work', name: 'loc', email: 'loc@vng.com.vn' };
const personal: GitIdentity = { label: 'Personal', name: 'loc', email: 'loc@gmail.com' };

describe('planAutoApply', () => {
	it('applies when enabled, unoverridden, and exactly one identity fits', () => {
		expect(
			planAutoApply({
				enabled: true,
				hasLocalOverride: false,
				activeEmail: 'loc@gmail.com',
				listMatched: [work],
			})
		).toEqual({ kind: 'apply', identity: work });
	});

	it('does nothing when the matching identity is already in use', () => {
		expect(
			planAutoApply({
				enabled: true,
				hasLocalOverride: false,
				activeEmail: work.email,
				listMatched: [work],
			})
		).toEqual({ kind: 'nothing' });
	});

	it('never touches a repository the user overrode by hand', () => {
		expect(
			planAutoApply({
				enabled: true,
				hasLocalOverride: true,
				activeEmail: 'loc@gmail.com',
				listMatched: [work],
			})
		).toEqual({ kind: 'leaveSuggestion' });
	});

	it('refuses to guess between two matching identities', () => {
		expect(
			planAutoApply({
				enabled: true,
				hasLocalOverride: false,
				activeEmail: null,
				listMatched: [work, personal],
			})
		).toEqual({ kind: 'leaveSuggestion' });
	});

	it('leaves everything to the suggestion UI while the setting is off', () => {
		expect(
			planAutoApply({
				enabled: false,
				hasLocalOverride: false,
				activeEmail: 'loc@gmail.com',
				listMatched: [work],
			})
		).toEqual({ kind: 'leaveSuggestion' });
	});

	it('does nothing when no identity matches at all', () => {
		expect(
			planAutoApply({ enabled: true, hasLocalOverride: false, activeEmail: null, listMatched: [] })
		).toEqual({ kind: 'nothing' });
	});
});
