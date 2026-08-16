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
