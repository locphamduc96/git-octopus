import type { CommitStat } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';

/** A commit's size never changes, so one answer per hash serves the whole session in a repository. */
let mapStats = $state<Record<string, CommitStat>>({});
/**
 * Every hash already asked about, answered or not: one the host could not read stays blank rather
 * than being asked for again on every scroll.
 */
const setAsked = new Set<string>();

const BATCH = 200;

onHostType('commitStats', (message) => {
	if (message.listStats.length === 0) return;
	const next = { ...mapStats };
	for (const stat of message.listStats) next[stat.hash] = stat;
	mapStats = next;
});

onRepoReset(() => {
	mapStats = {};
	setAsked.clear();
});

export const commitStats = {
	get map(): Record<string, CommitStat> {
		return mapStats;
	},
	/** Ask for the hashes not asked about yet, in batches the host reads with one `git log` each. */
	request(listHashes: string[]): void {
		const listNew = listHashes.filter((hash) => !setAsked.has(hash));
		for (const hash of listNew) setAsked.add(hash);
		for (let at = 0; at < listNew.length; at += BATCH) {
			postToHost({ type: 'loadCommitStats', listHashes: listNew.slice(at, at + BATCH) });
		}
	},
};
