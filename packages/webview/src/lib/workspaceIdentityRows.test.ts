import { describe, expect, it } from 'vitest';
import type { GitIdentity, WorkspaceIdentityEntry } from '@git-octopus/shared';
import { buildWorkspaceRows, canSaveEntry } from './workspaceIdentityRows';

function entry(repoName: string, email: string | null = null): WorkspaceIdentityEntry {
	return { repoPath: `/w/${repoName}`, repoName, name: null, email, overridden: false };
}

describe('buildWorkspaceRows', () => {
	it('shows nothing for an empty workspace or a single repository', () => {
		expect(buildWorkspaceRows([])).toEqual([]);
		expect(buildWorkspaceRows([entry('solo')])).toEqual([]);
	});

	it('sorts two or more repositories by name without touching the input', () => {
		const listInput = [entry('zeta'), entry('alpha'), entry('Mid')];
		const listRows = buildWorkspaceRows(listInput);
		expect(listRows.map((row) => row.repoName)).toEqual(['alpha', 'Mid', 'zeta']);
		expect(listInput.map((row) => row.repoName)).toEqual(['zeta', 'alpha', 'Mid']);
	});
});

describe('canSaveEntry', () => {
	const work: GitIdentity = { label: 'Work', name: 'locpd2', email: 'locpd2@vng.com.vn' };

	it('offers a save for an email no card has', () => {
		expect(canSaveEntry(entry('a', 'loc@gmail.com'), [work])).toBe(true);
	});

	it('offers nothing once a card carries that email', () => {
		expect(canSaveEntry(entry('a', 'locpd2@vng.com.vn'), [work])).toBe(false);
	});

	it('offers nothing for a row without an email', () => {
		expect(canSaveEntry(entry('a'), [])).toBe(false);
	});
});
