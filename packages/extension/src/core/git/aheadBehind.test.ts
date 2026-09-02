import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { getAheadBehind } from './gitService';

describe('getAheadBehind', () => {
	it('reads the left count as behind and the right as ahead', async () => {
		// `rev-list --left-right --count @{upstream}...HEAD` prints upstream-only first. Swapping
		// the two flips the ↑/↓ badge and the header counts, and no parser test would see it.
		const git = fakeGit({ 'rev-list': '2\t5\n' });

		expect(await getAheadBehind(git, '/repo')).toEqual({ ahead: 5, behind: 2 });
	});

	it('walks the range in the order the two counts are read from', async () => {
		const git = fakeGit({ 'rev-list': '0\t0\n' });

		await getAheadBehind(git, '/repo');

		expect(git.listCalls[0]).toEqual(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
	});

	it('answers zeroes when there is no upstream to compare against', async () => {
		// git exits non-zero for a branch with no upstream — that is "nothing to report", not a fault.
		const git = fakeGit().rejectOn('rev-list', "fatal: no upstream configured for branch 'main'");

		expect(await getAheadBehind(git, '/repo')).toEqual({ ahead: 0, behind: 0 });
	});

	it('answers zeroes for output it cannot read as two numbers', async () => {
		const git = fakeGit({ 'rev-list': '\n' });

		expect(await getAheadBehind(git, '/repo')).toEqual({ ahead: 0, behind: 0 });
	});
});
