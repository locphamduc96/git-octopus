import type { GitIdentity } from '@git-octopus/shared';
import type { RepoIdentityState } from './viewSettings';

/** What the badges on one saved-identity card should say. */
export interface CardBadges {
	/** Carries the "In use" pill: this card is the override actually in force. */
	showInUse: boolean;
	/** Apply would change nothing, so the button is disabled. */
	applyDisabled: boolean;
	/** Duplicates the global identity — worth a note (and a deletion) instead of a second pill. */
	sameAsGlobal: boolean;
}

/**
 * The pill lives in exactly one place. Without the `overridden` condition, a saved identity that
 * happens to equal the global one shows "In use" next to the global card's own pill — two cards
 * both claiming the same fact, which reads as two different identities being active at once.
 */
export function cardBadges(
	identity: RepoIdentityState | null,
	item: GitIdentity,
	overridden: boolean
): CardBadges {
	const matchesEffective =
		identity !== null && identity.email === item.email && identity.name === item.name;
	const sameAsGlobal =
		identity !== null &&
		(identity.globalName ?? identity.globalEmail) !== null &&
		identity.globalEmail === item.email &&
		identity.globalName === item.name;
	return {
		showInUse: overridden && matchesEffective,
		applyDisabled: matchesEffective,
		sameAsGlobal,
	};
}

/**
 * The identity actually committing right now when no saved card covers it yet — the prompt to
 * save it. Matching is by email alone: a saved card with the same email but another name is the
 * same account spelled differently, not a second account worth a second card.
 */
export function unsavedCurrentIdentity(
	identity: RepoIdentityState | null,
	listIdentities: GitIdentity[]
): { name: string; email: string } | null {
	if (identity === null || identity.email === null) return null;
	const email = identity.email;
	if (listIdentities.some((item) => item.email === email)) return null;
	return { name: identity.name ?? '', email };
}
