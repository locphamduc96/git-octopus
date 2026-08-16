import { describe, expect, it } from 'vitest';
import { formatCommitDate, relativeDate } from './commitDate';

/** Local time, so the assertions read in the same clock the formatter uses. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): Date {
	return new Date(year, month - 1, day, hour, minute);
}
const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const now = at(2026, 8, 15, 15, 30);

describe('formatCommitDate — dayTime', () => {
	it('names today', () => {
		const result = formatCommitDate(seconds(at(2026, 8, 15, 9, 5)), 'dayTime', now);
		expect(result.startsWith('Today ')).toBe(true);
	});

	it('names yesterday', () => {
		const result = formatCommitDate(seconds(at(2026, 8, 14, 23, 50)), 'dayTime', now);
		expect(result.startsWith('Yesterday ')).toBe(true);
	});

	it('counts calendar days, so 23:50 yesterday is not "today" seven hours later', () => {
		const lateLastNight = seconds(at(2026, 8, 14, 23, 50));
		const earlyToday = at(2026, 8, 15, 6, 0);
		expect(formatCommitDate(lateLastNight, 'dayTime', earlyToday).startsWith('Yesterday ')).toBe(
			true
		);
	});

	it('counts calendar days the other way too: 00:30 today stays today all day', () => {
		const justAfterMidnight = seconds(at(2026, 8, 15, 0, 30));
		expect(formatCommitDate(justAfterMidnight, 'dayTime', now).startsWith('Today ')).toBe(true);
	});

	it('falls back to the date once it is older than yesterday', () => {
		const result = formatCommitDate(seconds(at(2026, 8, 13, 10, 0)), 'dayTime', now);
		expect(result).not.toContain('Today');
		expect(result).not.toContain('Yesterday');
		expect(result).toContain(at(2026, 8, 13).toLocaleDateString());
	});

	it('keeps the time on every branch, which is the point of the format', () => {
		const stamp = seconds(at(2026, 8, 15, 9, 5));
		const clock = at(2026, 8, 15, 9, 5).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		});
		expect(formatCommitDate(stamp, 'dayTime', now)).toBe(`Today ${clock}`);
	});
});

describe('formatCommitDate — other formats', () => {
	const stamp = seconds(at(2026, 8, 15, 9, 5));

	it('date only drops the clock', () => {
		expect(formatCommitDate(stamp, 'dateOnly', now)).toBe(at(2026, 8, 15).toLocaleDateString());
	});

	it('iso prints a sortable stamp without the T', () => {
		expect(formatCommitDate(stamp, 'iso', now)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
	});
});

describe('relativeDate', () => {
	it('counts in the largest unit that fits', () => {
		expect(relativeDate(seconds(at(2026, 8, 15, 13, 30)), now)).toBe('2 hours ago');
		expect(relativeDate(seconds(at(2026, 8, 12, 15, 30)), now)).toBe('3 days ago');
	});

	it('drops the plural for one', () => {
		expect(relativeDate(seconds(at(2026, 8, 15, 14, 30)), now)).toBe('1 hour ago');
	});

	it('says "just now" under a minute, and never counts backwards for a future stamp', () => {
		expect(relativeDate(seconds(at(2026, 8, 15, 15, 30)), now)).toBe('just now');
		expect(relativeDate(seconds(at(2026, 8, 16, 15, 30)), now)).toBe('just now');
	});
});
