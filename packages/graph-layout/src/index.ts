import type { Commit, GraphRow } from '@git-octopus/shared';

/**
 * Pure graph layout engine: assign each commit a column and compute the connecting lines.
 *
 * Scaffold stage: a trivial single-column placeholder so the pipeline (data → layout → SVG)
 * is wired end to end. The real branch-assignment algorithm is specified in
 * `03-specs/graph-layout-engine.md` and implemented in Feature 002, Phase 1.
 */
export function layoutCommits(listCommits: Commit[]): GraphRow[] {
	return listCommits.map((commit) => ({
		commit,
		column: 0,
		lines: [],
	}));
}
