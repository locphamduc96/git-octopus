import type { GitIdentity } from '@git-octopus/shared';

export interface AutoApplyState {
	/** The user's opt-in setting; off means the suggestion UI is as far as it goes. */
	enabled: boolean;
	/** The repository already carries its own identity override — never touched. */
	hasLocalOverride: boolean;
	/** The email git commits with right now, or null when it has none. */
	activeEmail: string | null;
	/** Saved identities whose pattern matches this repository's remotes, in saved order. */
	listMatched: GitIdentity[];
}

export type AutoApplyPlan =
	/** Exactly one identity fits and it is not in use: write it to the repo's local config. */
	| { kind: 'apply'; identity: GitIdentity }
	/** Something fits but acting would guess — the existing warning UI carries it instead. */
	| { kind: 'leaveSuggestion' }
	| { kind: 'nothing' };

/**
 * Whether the host should be asked to apply an identity without a click.
 *
 * Acting is held to a stricter bar than suggesting: an override the user made by hand is never
 * overwritten, and two matching identities mean the remotes are ambiguous — picking the first
 * would be a guess wearing the settings' clothes.
 */
export function planAutoApply(state: AutoApplyState): AutoApplyPlan {
	if (state.listMatched.length === 0) return { kind: 'nothing' };
	if (!state.enabled || state.hasLocalOverride || state.listMatched.length > 1) {
		return { kind: 'leaveSuggestion' };
	}
	const identity = state.listMatched[0];
	if (identity.email === state.activeEmail) return { kind: 'nothing' };
	return { kind: 'apply', identity };
}
