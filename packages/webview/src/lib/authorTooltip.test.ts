import { describe, expect, it } from 'vitest';
import type { Commit } from '@git-octopus/shared';
import { authorTooltip } from './authorTooltip';

const NOW = new Date('2026-08-17T12:00:00Z');

function commit(overrides: Partial<Commit> = {}): Commit {
	return {
		hash: 'abc1234',
		parents: [],
		author: { name: 'Loc Pham', email: 'loc@example.com' },
		authoredAt: Math.floor(new Date('2026-08-17T10:00:00Z').getTime() / 1000),
		committedAt: Math.floor(new Date('2026-08-16T10:00:00Z').getTime() / 1000),
		subject: 'Draw the graph a row at a time',
		refs: [],
		...overrides,
	};
}

describe('authorTooltip', () => {
	it('leads with the name and email, one per line', () => {
		const [name, email] = authorTooltip(commit(), 'author', NOW).split('\n');
		expect(name).toBe('Loc Pham');
		expect(email).toBe('loc@example.com');
	});

	it('dates the line by whichever timestamp the graph is showing', () => {
		// Author and committer dates are a day apart here, so the two lines cannot be confused.
		expect(authorTooltip(commit(), 'author', NOW)).toContain('Authored');
		expect(authorTooltip(commit(), 'author', NOW)).toContain('2 hours ago');
		expect(authorTooltip(commit(), 'commit', NOW)).toContain('Committed');
		expect(authorTooltip(commit(), 'commit', NOW)).toContain('1 day ago');
	});

	it('drops the email line when the commit has no email', () => {
		const lines = authorTooltip(
			commit({ author: { name: 'Loc Pham', email: '  ' } }),
			'author',
			NOW
		).split('\n');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe('Loc Pham');
	});

	it('names an author who has neither, rather than leaving a blank first line', () => {
		const lines = authorTooltip(commit({ author: { name: '', email: '' } }), 'author', NOW).split(
			'\n'
		);
		expect(lines[0]).toBe('Unknown author');
		expect(lines).toHaveLength(2);
	});
});
