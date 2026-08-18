import type { Commit } from '@git-octopus/shared';
import { formatCommitDate, relativeDate } from './commitDate';

/**
 * The lines shown when the pointer rests on a commit's avatar.
 *
 * Plain text with real newlines, not markup: the name and email come straight out of the repository
 * and are written to the tooltip as `textContent`.
 */
export function authorTooltip(
	commit: Commit,
	dateType: 'commit' | 'author',
	now = new Date()
): string {
	const lines = [commit.author.name.trim()].filter((line) => line !== '');
	const email = commit.author.email.trim();
	if (email !== '') lines.push(email);

	const authored = dateType === 'author';
	const at = authored ? commit.authoredAt : commit.committedAt;
	const when = `${formatCommitDate(at, 'dateTime', now)} (${relativeDate(at, now)})`;
	lines.push(`${authored ? 'Authored' : 'Committed'} ${when}`);

	// An author with neither name nor email would otherwise show a date under a blank first line.
	if (lines.length === 1) lines.unshift('Unknown author');
	return lines.join('\n');
}
