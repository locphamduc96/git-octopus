import { describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import { buildIdentityMenu, IDENTITY_ITEM, type IdentityMenuInput } from './identityMenu';

const work: GitIdentity = { label: 'Work', name: 'loc', email: 'loc@work.com' };
const home: GitIdentity = { label: 'Home', name: 'loc', email: 'loc@home.com' };

function menu(overrides: Partial<IdentityMenuInput> = {}) {
	return buildIdentityMenu({
		listIdentities: [work, home],
		activeEmail: work.email,
		suggestedIdentity: null,
		globalIdentity: { name: 'loc', email: 'loc@home.com' },
		overridden: false,
		...overrides,
	});
}

describe('buildIdentityMenu', () => {
	it('lists every saved identity, in order, before the actions', () => {
		const listIds = menu().map((item) => item.id);
		expect(listIds).toEqual(['0', '1', IDENTITY_ITEM.add, IDENTITY_ITEM.manage]);
	});

	it('ticks the identity Git is committing with', () => {
		expect(menu()[0].label).toContain('✓');
		expect(menu()[1].label).not.toContain('✓');
	});

	it('puts the remote suggestion first, so the amber button says what it wants', () => {
		const listItems = menu({ suggestedIdentity: home });
		expect(listItems[0].id).toBe(IDENTITY_ITEM.suggested);
		expect(listItems[0].label).toContain(home.email);
		// The saved list then needs a separator, or it reads as part of the warning.
		expect(listItems[1].separatorBefore).toBe(true);
	});

	it('lists the in-use identity even when it was never saved', () => {
		const listItems = menu({ activeEmail: 'stray@example.com' });
		const unsaved = listItems.find((item) => item.id === IDENTITY_ITEM.unsavedCurrent);
		expect(unsaved?.label).toBe('stray@example.com — from Git config   ✓');
	});

	it('offers the way back to the global config only while an override is in force', () => {
		expect(menu().some((item) => item.id === IDENTITY_ITEM.useGlobal)).toBe(false);
		const listItems = menu({ overridden: true, activeEmail: work.email });
		const back = listItems.find((item) => item.id === IDENTITY_ITEM.useGlobal);
		expect(back?.label).toBe('Use global config — loc@home.com');
	});

	it('falls back to the global name when the global config has no email', () => {
		const listItems = menu({ overridden: true, globalIdentity: { name: 'loc', email: null } });
		expect(listItems.find((item) => item.id === IDENTITY_ITEM.useGlobal)?.label).toBe(
			'Use global config — loc'
		);
	});

	it('offers no way back when there is no global identity at all', () => {
		const listItems = menu({ overridden: true, globalIdentity: null });
		expect(listItems.some((item) => item.id === IDENTITY_ITEM.useGlobal)).toBe(false);
	});

	it('drops the separator above Add when nothing is saved yet', () => {
		const listItems = buildIdentityMenu({
			listIdentities: [],
			activeEmail: null,
			suggestedIdentity: null,
			globalIdentity: null,
			overridden: false,
		});
		expect(listItems.map((item) => item.id)).toEqual([IDENTITY_ITEM.add, IDENTITY_ITEM.manage]);
		expect(listItems[0].separatorBefore).toBe(false);
	});
});
