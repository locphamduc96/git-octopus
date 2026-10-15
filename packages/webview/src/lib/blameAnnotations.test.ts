import { describe, expect, it } from 'vitest';
import { blameLabel, buildBlameBlocks, formatAge, UNCOMMITTED_BLAME } from './blameAnnotations';

describe('buildBlameBlocks', () => {
	it('starts a block wherever the commit changes, alternating the shade', () => {
		expect(buildBlameBlocks(['a', 'a', 'b', 'a', 'a'])).toEqual({
			listStarts: [true, false, true, true, false],
			listParity: [0, 0, 1, 0, 0],
		});
	});

	it('is empty for an empty file', () => {
		expect(buildBlameBlocks([])).toEqual({ listStarts: [], listParity: [] });
	});
});

describe('formatAge', () => {
	const NOW = 1_700_000_000_000;
	const ago = (seconds: number) => formatAge(NOW / 1000 - seconds, NOW);

	it('counts up through the units', () => {
		expect(ago(5)).toBe('just now');
		expect(ago(120)).toBe('2m ago');
		expect(ago(3 * 3600)).toBe('3h ago');
		expect(ago(4 * 86400)).toBe('4d ago');
		expect(ago(65 * 86400)).toBe('2mo ago');
		expect(ago(800 * 86400)).toBe('2y ago');
	});

	it('never goes negative for a clock that is behind', () => {
		expect(formatAge(NOW / 1000 + 100, NOW)).toBe('just now');
	});
});

describe('blameLabel', () => {
	it('names the short hash, the author and the age', () => {
		const label = blameLabel(
			'a'.repeat(40),
			{ author: 'Ada', authoredAt: 0, summary: 'first' },
			3600_000
		);
		expect(label.text).toBe('aaaaaaa Ada · 1h ago');
		expect(label.detail.startsWith('first\nAda, ')).toBe(true);
	});

	it('says plainly when the line is not committed', () => {
		expect(blameLabel(UNCOMMITTED_BLAME, undefined).text).toBe('Not committed yet');
	});
});
