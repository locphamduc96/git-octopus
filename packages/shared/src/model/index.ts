/**
 * Domain model — derived from real `git` output, not from any other project's types.
 * Kept intentionally small; grows per feature (see Feature 002).
 */

export interface Person {
	name: string;
	email: string;
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
	subject: string;
	refs: Ref[];
	/** True for the synthetic "Uncommitted Changes" node at the top of the graph. */
	isUncommitted?: boolean;
}

/** Sentinel hash used for the synthetic uncommitted-changes node. */
export const UNCOMMITTED_HASH = '*uncommitted*';

/** A single connecting line from a graph row down to the next row. */
export interface GraphEdge {
	fromColumn: number;
	toColumn: number;
	colour: number;
}

/** One rendered row of the graph — output of the pure graph-layout engine. */
export interface GraphRow {
	commit: Commit;
	nodeColumn: number;
	nodeColour: number;
	edges: GraphEdge[];
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X' | '?';

export interface FileChange {
	status: FileStatus;
	path: string;
	oldPath?: string;
}

export interface CommitDetails {
	hash: string;
	body: string;
	files: FileChange[];
}

export interface WorkingTreeStatus {
	staged: FileChange[];
	unstaged: FileChange[];
}
