import { describe, expect, it } from 'vitest';
import { LIST_MERGE_OPTIONS, mergeArgs } from './mergePlan.js';

describe('mergeArgs', () => {
	it('builds the default merge with a merge commit', () => {
		expect(mergeArgs('feature/x', ['no-ff'])).toEqual(['merge', 'feature/x', '--no-ff']);
	});

	it('lets squash win over no-ff', () => {
		expect(mergeArgs('feature/x', ['no-ff', 'squash'])).toEqual(['merge', 'feature/x', '--squash']);
	});

	it('appends no-commit to either form', () => {
		expect(mergeArgs('feature/x', ['no-ff', 'no-commit'])).toEqual([
			'merge',
			'feature/x',
			'--no-ff',
			'--no-commit',
		]);
		expect(mergeArgs('feature/x', ['squash', 'no-commit'])).toEqual([
			'merge',
			'feature/x',
			'--squash',
			'--no-commit',
		]);
	});

	it('merges plain when nothing is selected', () => {
		expect(mergeArgs('feature/x', [])).toEqual(['merge', 'feature/x']);
	});

	it('offers exactly the three options, no-ff picked by default', () => {
		expect(LIST_MERGE_OPTIONS.map((option) => option.id)).toEqual(['no-ff', 'squash', 'no-commit']);
		expect(LIST_MERGE_OPTIONS[0].picked).toBe(true);
	});
});
