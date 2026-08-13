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
	| { kind: 'head' };

export interface Commit {
	hash: string;
	parents: string[];
	author: Person;
	committedAt: number; // epoch seconds
	subject: string;
	refs: Ref[];
}

/** One rendered row of the graph — output of the pure graph-layout engine. */
export interface GraphRow {
	commit: Commit;
	column: number;
	lines: GraphLine[];
}

export interface GraphLine {
	fromColumn: number;
	toColumn: number;
	colour: number;
}
