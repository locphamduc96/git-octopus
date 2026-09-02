import type { UpstreamTracking } from '@git-octopus/shared';

/** What `%(upstream:trackshort)` claims, as the pair of booleans the counts are checked against. */
function directionOf(trackShort: string): { ahead: boolean; behind: boolean } | null {
	switch (trackShort.trim()) {
		case '=':
			return { ahead: false, behind: false };
		case '>':
			return { ahead: true, behind: false };
		case '<':
			return { ahead: false, behind: true };
		case '<>':
			return { ahead: true, behind: true };
		default:
			// Empty for a branch whose upstream is gone, and for anything unrecognised. Neither is a
			// claim about direction, so there is nothing to check the counts against.
			return null;
	}
}

function countIn(track: string, word: string): number {
	const match = new RegExp(`${word} (\\d+)`).exec(track);
	if (!match) return 0;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * What `git for-each-ref` says about a local branch's upstream, turned into numbers — or `null`
 * when the branch has no upstream at all.
 *
 * Three fields are read rather than one, because no single one of them answers the question:
 *
 * - `%(upstream:short)` is the only thing that separates "no upstream configured" from "in sync" —
 *   `%(upstream:track)` is empty for both.
 * - `%(upstream:track)` carries the counts, but its words go through gettext, so a translated git
 *   could hand back a string the numbers cannot be read out of.
 * - `%(upstream:trackshort)` is `=`, `>`, `<` or `<>` in every locale, so it is the one field that
 *   can be trusted for which *direction* the branch has drifted.
 *
 * The counts come from `track` and are kept only while `trackshort` agrees with them. A
 * disagreement means the words were not the ones expected, and the honest answer is the direction
 * with an unread count — never "in sync", which is the one reading a user would act on.
 *
 * `null` rather than a zeroed record for a branch with no upstream: never pushed and level with
 * the upstream are different facts, and only one of them is worth drawing.
 */
export function parseUpstreamTracking(
	upstream: string,
	track: string,
	trackShort: string
): UpstreamTracking | null {
	const name = upstream.trim();
	if (name === '') return null;

	const text = track.trim();
	if (text === '[gone]') return { upstream: name, ahead: 0, behind: 0, gone: true };

	const ahead = countIn(text, 'ahead');
	const behind = countIn(text, 'behind');
	const claimed = directionOf(trackShort);
	// No usable direction to check against — the counts are all there is, so take them as read.
	if (!claimed) return { upstream: name, ahead, behind, gone: false };

	if (claimed.ahead === ahead > 0 && claimed.behind === behind > 0)
		return { upstream: name, ahead, behind, gone: false };

	// `track` did not parse into what `trackshort` describes. Keep the direction, drop the numbers.
	return {
		upstream: name,
		ahead: claimed.ahead ? null : 0,
		behind: claimed.behind ? null : 0,
		gone: false,
	};
}
