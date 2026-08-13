import { describe, expect, it } from 'vitest';
import type { Commit } from '@git-octopus/shared';
import { layoutCommits } from './index.js';

function makeCommit(hash: string, parents: string[]): Commit {
	return {
		hash,
		parents,
		author: { name: 'Test', email: 'test@example.com' },
		committedAt: 0,
		subject: hash,
		refs: [],
	};
}

describe('layoutCommits', () => {
	it('returns one row per commit', () => {
		const listCommits = [makeCommit('a', ['b']), makeCommit('b', [])];
		const listRows = layoutCommits(listCommits);
		expect(listRows).toHaveLength(2);
		expect(listRows[0].commit.hash).toBe('a');
	});

	it('places every commit on a column (placeholder: column 0)', () => {
		const listRows = layoutCommits([makeCommit('a', [])]);
		expect(listRows[0].column).toBe(0);
	});
});
