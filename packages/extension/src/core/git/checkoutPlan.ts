/**
 * What checking out a branch from its remote chip should actually run.
 *
 * A remote chip and a local branch of the same name sit on different rows whenever the local one
 * has fallen behind, so the view cannot tell that the local branch exists — it only knows what is
 * on the commit it drew. Asking git first is what stops `checkout -b` from failing with "already
 * exists" on the branch the user pulled yesterday.
 */
export interface CheckoutState {
	/** Whether `refs/heads/<name>` already exists. */
	localExists: boolean;
	/** Commits the local branch has that the remote does not. */
	ahead: number;
	/** Commits the remote has that the local branch does not. */
	behind: number;
	/** Tracked files are modified, so a fast-forward could refuse or overwrite work in progress. */
	dirty: boolean;
	/** The user's setting; false leaves the branch where it is and only reports the gap. */
	autoFastForward: boolean;
}

export type CheckoutPlan =
	/** No local branch yet: make one that tracks the remote. */
	| { kind: 'createTracking' }
	/** Check the local branch out and leave it alone; `note` explains a gap left unclosed. */
	| { kind: 'checkoutOnly'; note?: string }
	/** Check the local branch out, then fast-forward it onto the remote. */
	| { kind: 'checkoutFastForward'; count: number };

/**
 * Fast-forwarding is only ever offered when the local branch has nothing of its own: `--ff-only`
 * would refuse a diverged branch anyway, and refusing here means the user reads a sentence about
 * their branch instead of an error from a command they never asked for.
 */
export function planCheckout(state: CheckoutState): CheckoutPlan {
	if (!state.localExists) return { kind: 'createTracking' };
	if (state.behind === 0) return { kind: 'checkoutOnly' };

	const gap = `${state.behind} commit${state.behind === 1 ? '' : 's'} behind`;
	if (state.ahead > 0) {
		return { kind: 'checkoutOnly', note: `${gap} and ${state.ahead} ahead — branches diverged` };
	}
	if (!state.autoFastForward) return { kind: 'checkoutOnly', note: gap };
	if (state.dirty)
		return { kind: 'checkoutOnly', note: `${gap}; uncommitted changes left it alone` };
	return { kind: 'checkoutFastForward', count: state.behind };
}

/** `git rev-list --count --left-right <local>...<remote>` — left is ahead, right is behind. */
export function parseAheadBehind(output: string): { ahead: number; behind: number } {
	const [left, right] = output.trim().split(/\s+/);
	const ahead = Number(left);
	const behind = Number(right);
	return {
		ahead: Number.isFinite(ahead) ? ahead : 0,
		behind: Number.isFinite(behind) ? behind : 0,
	};
}
