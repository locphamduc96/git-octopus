import type { GitIdentity } from '@git-octopus/shared';

/**
 * Ids of the entries that are not a saved identity. They start with a space so they can never
 * collide with the index-based ids the saved identities use.
 */
export const IDENTITY_ITEM = {
	add: ' add',
	manage: ' manage',
	suggested: ' suggested',
	unsavedCurrent: ' current',
	useGlobal: ' global',
} as const;

export interface IdentityMenuItem {
	id: string;
	label: string;
	separatorBefore?: boolean;
}

export interface IdentityMenuInput {
	listIdentities: GitIdentity[];
	/** The email Git commits with in this repository, or null when it has none. */
	activeEmail: string | null;
	/** Set when the repository's remote points at an identity other than the one in use. */
	suggestedIdentity: GitIdentity | null;
	/** The global config's identity, and whether this repository overrides it. */
	globalIdentity: { name: string | null; email: string | null } | null;
	overridden: boolean;
}

/**
 * Build the account menu.
 *
 * Three things beyond the saved list have to be in it, each for a reason that is easy to lose:
 * the remote's suggestion (a colour on the button never says *which* identity was expected), the
 * identity Git is actually using when it was never saved (without it the tick vanishes, which
 * reads as "nothing is selected"), and the way back to the global config while an override is in
 * force (without it the menu is a one-way door).
 */
export function buildIdentityMenu(input: IdentityMenuInput): IdentityMenuItem[] {
	const { listIdentities, activeEmail, suggestedIdentity, globalIdentity, overridden } = input;
	const listItems: IdentityMenuItem[] = [];

	if (suggestedIdentity) {
		listItems.push({
			id: IDENTITY_ITEM.suggested,
			label: `⚠ This repo suggests ${suggestedIdentity.label} — switch to ${suggestedIdentity.email}`,
		});
	}

	listIdentities.forEach((item, index) => {
		listItems.push({
			id: String(index),
			label: `${item.label} — ${item.email}${item.email === activeEmail ? '   ✓' : ''}`,
			separatorBefore: index === 0 && suggestedIdentity !== null,
		});
	});

	if (activeEmail && !listIdentities.some((item) => item.email === activeEmail)) {
		listItems.push({
			id: IDENTITY_ITEM.unsavedCurrent,
			label: `${activeEmail} — from Git config   ✓`,
			separatorBefore: listIdentities.length > 0,
		});
	}

	const globalLabel = globalIdentity?.email ?? globalIdentity?.name ?? null;
	if (overridden && globalLabel) {
		listItems.push({
			id: IDENTITY_ITEM.useGlobal,
			label: `Use global config — ${globalLabel}`,
			separatorBefore: true,
		});
	}

	listItems.push({
		id: IDENTITY_ITEM.add,
		label: 'Add identity…',
		separatorBefore: listIdentities.length > 0,
	});
	listItems.push({ id: IDENTITY_ITEM.manage, label: 'Manage identities…' });
	return listItems;
}
