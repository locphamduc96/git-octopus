/**
 * Domain model — derived from real `git` output, not from any other project's types.
 * Kept intentionally small; grows per feature (see Feature 002).
 */

export interface Person {
	name: string;
	email: string;
	/** Gravatar URL, only present when avatar fetching is enabled. */
	avatarUrl?: string;
}

/**
 * How far a local branch has drifted from its upstream.
 *
 * Lives in the shared model rather than beside its parser: the host reads it out of git, the
 * webview draws it, and both need the same two questions answered the same way (`hasGap`,
 * `isLevel`). The parser itself stays on the host — see `core/git/upstreamTrack.ts` for why three
 * `for-each-ref` fields are needed to fill this in honestly.
 */
export interface UpstreamTracking {
	/** The upstream ref, short form: "origin/main". */
	upstream: string;
	/** Commits this branch has that the upstream does not. `null` when the count could not be read. */
	ahead: number | null;
	/** Commits the upstream has that this branch does not. `null` when the count could not be read. */
	behind: number | null;
	/** The upstream is still configured, but its remote-tracking ref is gone. */
	gone: boolean;
}

/** Whether a count means "there is a gap", counting an unread number as one. */
export function hasGap(count: number | null): boolean {
	return count === null || count > 0;
}

/** True when there is nothing to draw: level with the upstream, and it still exists. */
export function isLevel(tracking: UpstreamTracking): boolean {
	return !tracking.gone && !hasGap(tracking.ahead) && !hasGap(tracking.behind);
}

/**
 * The auto-fetch intervals offered, in minutes. Zero is "never".
 *
 * Shared because both sides narrow against it: the view renders the options, and the host has to
 * refuse a stored value that is not one of them rather than arm a timer for it.
 */
export const LIST_AUTO_FETCH_MINUTES = [0, 1, 5, 15, 30, 60] as const;

/**
 * How often to fetch before anyone has chosen — on, every minute.
 *
 * Declared here rather than only in the view's defaults because the two sides learn it by different
 * routes: the view spreads its defaults over whatever was stored, while the host reads the stored
 * blob directly and sees nothing at all until the view has saved one. A default that lived only in
 * the view would leave the host fetching never, on exactly the fresh installs the default is for.
 */
export const DEFAULT_AUTO_FETCH_MINUTES = 1;

/**
 * A stored value narrowed back to an offered interval.
 *
 * Absent or unrecognised falls back to the default rather than to never: never is a choice a user
 * makes by picking it, and a missing value is the absence of a choice — the two must not read the
 * same. Zero is kept as zero for exactly that reason.
 */
export function pickAutoFetchMinutes(raw: unknown): number {
	return typeof raw === 'number' && LIST_AUTO_FETCH_MINUTES.includes(raw as never)
		? raw
		: DEFAULT_AUTO_FETCH_MINUTES;
}

export type Ref =
	| { kind: 'branch'; name: string; remote?: string }
	| { kind: 'tag'; name: string }
	| { kind: 'stash'; name: string }
	| { kind: 'head' };

export interface Commit {
	hash: string;
	parents: string[];
	author: Person;
	committedAt: number; // epoch seconds
	authoredAt: number; // epoch seconds
	subject: string;
	refs: Ref[];
	/** True for the synthetic "Uncommitted Changes" node at the top of the graph. */
	isUncommitted?: boolean;
}

/** Sentinel hash used for the synthetic uncommitted-changes node. */
export const UNCOMMITTED_HASH = '*uncommitted*';

/**
 * The arm of a switch no value can reach.
 *
 * Passing a value that is not `never` is a compile error, so a union that grows a member no case
 * answers for fails the build instead of becoming a control that silently does nothing.
 */
export function assertNever(_unreachable: never): void {}

/**
 * A lane crossing a row: the commit it is waiting for, the colour it is drawn in, and the stable
 * identity of the branch line it belongs to. Colours cycle and repeat; `branch` never does, so it
 * is what hover-highlighting matches on.
 */
export interface GraphLane {
	hash: string;
	colour: number;
	branch: number;
}

/**
 * One rendered row of the graph — output of the pure graph-layout engine.
 *
 * A row describes only its own band, by the lanes crossing its top and bottom edges, so it can be
 * drawn without looking at any other row. Both lists are indexed by column and hold `null` where a
 * column is empty; a lane keeps its column for its whole life, so `listOutputLanes` of one row is
 * `listInputLanes` of the next.
 */
export interface GraphRow {
	commit: Commit;
	nodeColumn: number;
	nodeColour: number;
	/** Branch-line identity of the node's own lane — see {@link GraphLane.branch}. */
	nodeBranch: number;
	listInputLanes: (GraphLane | null)[];
	listOutputLanes: (GraphLane | null)[];
	/**
	 * Columns this commit's parents leave in. Usually just the node's own column, but a parent
	 * already awaited by another lane is *not* a new lane, so nothing in `listOutputLanes` would say
	 * this commit connects to it — and its node would hang there with no line out.
	 */
	listParentColumns: number[];
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X' | '?';

export interface FileChange {
	status: FileStatus;
	path: string;
	oldPath?: string;
	/** Line counts, absent for binary files and for working-tree entries. */
	additions?: number;
	deletions?: number;
}

/**
 * One line of a unified diff. Both line numbers are kept so either gutter can be printed: an added
 * line has no old number, a deleted one has no new number.
 */
export interface DiffLine {
	kind: 'context' | 'add' | 'del';
	text: string;
	oldLine: number | null;
	newLine: number | null;
}

export interface DiffHunk {
	oldStart: number;
	newStart: number;
	/** The text git prints after the `@@`, usually the enclosing function. */
	heading: string;
	listLines: DiffLine[];
}

export interface CommitDetails {
	hash: string;
	parents: string[];
	author: Person;
	authoredAt: number;
	committer: Person;
	committedAt: number;
	body: string;
	files: FileChange[];
}

export interface WorkingTreeStatus {
	staged: FileChange[];
	unstaged: FileChange[];
}
