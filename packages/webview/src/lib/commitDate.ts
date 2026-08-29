import { assertNever } from '@git-octopus/shared';

export type DateFormat = 'dateTime' | 'dayTime' | 'dateOnly' | 'iso' | 'relative';

function time(date: Date): string {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Whole days between two instants, counted by calendar day rather than by elapsed hours. */
function daysApart(date: Date, now: Date): number {
	const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	return Math.round((to - from) / 86_400_000);
}

/**
 * Format a commit timestamp for the Date column.
 *
 * `now` is passed in rather than read here: "today" is a question about the reader's clock, and a
 * function that answers it from a hidden global cannot be tested at a date boundary.
 */
export function formatCommitDate(
	epochSeconds: number,
	format: DateFormat,
	now = new Date()
): string {
	const date = new Date(epochSeconds * 1000);
	switch (format) {
		case 'dateOnly':
			return date.toLocaleDateString();
		case 'iso':
			return date.toISOString().slice(0, 16).replace('T', ' ');
		case 'relative':
			return relativeDate(epochSeconds, now);
		case 'dayTime': {
			// Counted in calendar days, so a commit at 00:30 is "today" all through the morning and
			// yesterday's 23:50 commit never reads as today just because it was seven hours ago.
			const days = daysApart(date, now);
			if (days === 0) return `Today ${time(date)}`;
			if (days === 1) return `Yesterday ${time(date)}`;
			return `${date.toLocaleDateString()} ${time(date)}`;
		}
		case 'dateTime':
			return `${date.toLocaleDateString()} ${time(date)}`;
		default:
			assertNever(format);
			// Unreachable, and deliberately the same string `dateTime` renders: an unknown format is
			// still a date to draw, not a blank cell.
			return `${date.toLocaleDateString()} ${time(date)}`;
	}
}

/** "3 days ago" and friends; anything under a minute is "just now". */
export function relativeDate(epochSeconds: number, now = new Date()): string {
	const seconds = Math.max(0, Math.floor(now.getTime() / 1000) - epochSeconds);
	const listUnits: [number, string][] = [
		[31536000, 'year'],
		[2592000, 'month'],
		[86400, 'day'],
		[3600, 'hour'],
		[60, 'minute'],
	];
	for (const [size, name] of listUnits) {
		if (seconds >= size) {
			const value = Math.floor(seconds / size);
			return `${value} ${name}${value === 1 ? '' : 's'} ago`;
		}
	}
	return 'just now';
}
