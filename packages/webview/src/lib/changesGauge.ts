import type { CommitStat } from '@git-octopus/shared';

/** Lines changed at which the gauge is full; sizes are read on a log scale up to here. */
const FULL_AT = 10_000;

/**
 * How the Changes cell draws one commit: the bar's length on a log scale — a one-line fix and a
 * thousand-line import both have to stay readable side by side — and the share of it that is added.
 */
export function changesGauge(stat: CommitStat): { widthPct: number; addedPct: number } {
	const total = stat.insertions + stat.deletions;
	if (total === 0) return { widthPct: 0, addedPct: 0 };
	const widthPct = Math.min(
		100,
		Math.max(8, (Math.log10(total + 1) / Math.log10(FULL_AT + 1)) * 100)
	);
	return { widthPct, addedPct: (stat.insertions / total) * 100 };
}

export function changesTooltip(stat: CommitStat): string {
	const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
	return `${plural(stat.files, 'file')} changed, ${plural(stat.insertions, 'insertion')}, ${plural(
		stat.deletions,
		'deletion'
	)}`;
}
