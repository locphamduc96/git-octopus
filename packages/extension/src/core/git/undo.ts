/**
 * Undoing the last thing that moved a ref.
 *
 * What is recorded is not what an action *said* it would do but what the repository *did*: every
 * local branch tip plus HEAD, snapshotted before and after, and diffed. Asking the action would
 * mean trusting thirty-odd `case` arms to each declare themselves honestly, and they cannot — a
 * merge may fast-forward, a rebase may be a no-op, and `fastForward` onto a branch that is not
 * checked out moves a ref HEAD never touches.
 */

/** Where HEAD is: on a branch, or detached at a commit. */
export interface HeadPosition {
	/** The branch HEAD is on, or null while detached. */
	branch: string | null;
	hash: string;
}

/** One local branch's tips before and after; `null` on either side means it did not exist. */
export interface RefChange {
	branch: string;
	before: string | null;
	after: string | null;
}

export interface RepoSnapshot {
	/** Local branch name -> tip hash. */
	mapTips: Record<string, string>;
	head: HeadPosition;
}

export interface UndoEntry {
	/** What to call this in the button's tooltip: "Merge feature into main". */
	label: string;
	listChanges: RefChange[];
	headBefore: HeadPosition;
	headAfter: HeadPosition;
}

/** Whether HEAD moved between two snapshots — a different branch, or a different detached commit. */
export function headMoved(before: HeadPosition, after: HeadPosition): boolean {
	if (before.branch !== after.branch) return true;
	// On a branch, the hash following the branch is a ref move, not a checkout.
	return before.branch === null && before.hash !== after.hash;
}

/**
 * What changed between two snapshots, or null when nothing did.
 *
 * Null rather than an empty entry: an action that moved no ref and left HEAD where it was has
 * nothing to undo, and offering a button for it would be a lie about what pressing it does.
 */
export function diffSnapshots(
	label: string,
	before: RepoSnapshot,
	after: RepoSnapshot
): UndoEntry | null {
	const listChanges: RefChange[] = [];
	const setNames = new Set([...Object.keys(before.mapTips), ...Object.keys(after.mapTips)]);
	for (const branch of [...setNames].sort()) {
		const wasAt = before.mapTips[branch] ?? null;
		const nowAt = after.mapTips[branch] ?? null;
		if (wasAt !== nowAt) listChanges.push({ branch, before: wasAt, after: nowAt });
	}
	if (listChanges.length === 0 && !headMoved(before.head, after.head)) return null;
	return { label, listChanges, headBefore: before.head, headAfter: after.head };
}

/**
 * The same change, the other way round — what redoing an undone action has to do.
 *
 * Redo needs no planner of its own: undoing the inverse is redoing, so every proof `planUndo`
 * makes (refs still where they were left, HEAD unmoved, a clean tree where it matters) holds for
 * redo too.
 */
export function invertEntry(entry: UndoEntry): UndoEntry {
	return {
		label: entry.label,
		listChanges: entry.listChanges.map((change) => ({
			branch: change.branch,
			before: change.after,
			after: change.before,
		})),
		headBefore: entry.headAfter,
		headAfter: entry.headBefore,
	};
}

/** Why an undo cannot run. Each one is shown to the user, so each has to say something true. */
export type UndoRefusal =
	| { reason: 'nothing' }
	| { reason: 'refMoved'; branch: string }
	| { reason: 'headMoved' }
	| { reason: 'dirty' };

export type UndoPlan =
	{ ok: true; listCommands: string[][]; label: string } | ({ ok: false } & UndoRefusal);

export interface UndoContext {
	entry: UndoEntry | null;
	/** The repository as it stands now — the same shape the entry was built from. */
	now: RepoSnapshot;
	/** Tracked or untracked changes are present. */
	dirty: boolean;
}

/** How HEAD is named to `git checkout`: a branch by name, a detached position by hash. */
function checkoutTarget(head: HeadPosition): string {
	return head.branch ?? head.hash;
}

/**
 * The commands that put the repository back, or the reason it must not be tried.
 *
 * Everything is re-proved here rather than when the button was drawn: the gap between the two is a
 * window the repository can move in, and an undo that runs on a stale claim is exactly the kind of
 * "helpful" write nobody asked for.
 */
export function planUndo(context: UndoContext): UndoPlan {
	const entry = context.entry;
	if (!entry) return { ok: false, reason: 'nothing' };

	if (headMoved(entry.headAfter, context.now.head)) return { ok: false, reason: 'headMoved' };
	for (const change of entry.listChanges) {
		const nowAt = context.now.mapTips[change.branch] ?? null;
		if (nowAt !== change.after) return { ok: false, reason: 'refMoved', branch: change.branch };
	}

	const restoresHead = headMoved(entry.headBefore, entry.headAfter);
	// The branch HEAD will be sitting on once it is back where it was; a `reset --hard` on it is the
	// only step here that rewrites the working tree.
	const headBranch = entry.headBefore.branch;
	const touchesWorkingTree =
		restoresHead ||
		entry.listChanges.some((change) => change.branch === headBranch && change.after !== null);
	if (touchesWorkingTree && context.dirty) return { ok: false, reason: 'dirty' };

	const listCommands: string[][] = [];
	// Branches the action deleted come back first: HEAD may be about to return to one of them — the
	// case of a redo that re-creates a branch and checks it out.
	for (const change of entry.listChanges) {
		if (change.after === null && change.before !== null)
			listCommands.push(['branch', change.branch, change.before]);
	}
	// Then HEAD: a branch created by the action cannot be deleted while HEAD is standing on it.
	if (restoresHead) listCommands.push(['checkout', checkoutTarget(entry.headBefore)]);

	for (const change of entry.listChanges) {
		if (change.before === null) {
			listCommands.push(['branch', '-D', change.branch]);
			continue;
		}
		if (change.after === null) continue;
		if (change.branch === headBranch) {
			listCommands.push(['reset', '--hard', change.before]);
			continue;
		}
		// Compare-and-swap: git refuses the write itself if the ref moved since it was checked, so
		// a race between the proof above and this command cannot clobber someone else's work.
		listCommands.push(['update-ref', `refs/heads/${change.branch}`, change.before, change.after]);
	}
	return { ok: true, listCommands, label: entry.label };
}

/** The sentence shown when an undo is refused. */
export function describeRefusal(refusal: UndoRefusal): string {
	switch (refusal.reason) {
		case 'nothing':
			return 'nothing to undo.';
		case 'headMoved':
			return 'the repository moved since that action — HEAD is no longer where it was left.';
		case 'refMoved':
			return `${refusal.branch} has moved since that action, so undoing it would discard work that came after.`;
		case 'dirty':
			return 'you have uncommitted changes, and undoing this would overwrite them.';
	}
}
