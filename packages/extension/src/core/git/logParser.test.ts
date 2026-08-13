import { describe, expect, it } from 'vitest';
import { parseLog } from './logParser.js';

const NUL = '\0';
function line(fields: string[]): string {
	return fields.join(NUL);
}

describe('parseLog', () => {
	it('parses a commit with a single parent', () => {
		const output = line(['abc', 'def', 'Ada', 'ada@x.io', '1700000000', 'Initial commit']);
		const [commit] = parseLog(output);
		expect(commit).toEqual({
			hash: 'abc',
			parents: ['def'],
			author: { name: 'Ada', email: 'ada@x.io' },
			committedAt: 1700000000,
			subject: 'Initial commit',
			refs: [],
		});
	});

	it('parses a merge (multiple parents) and a root (no parents)', () => {
		const output = [
			line(['m', 'a b', 'X', 'x@x', '10', 'Merge']),
			line(['r', '', 'X', 'x@x', '1', 'Root']),
		].join('\n');
		const listCommits = parseLog(output);
		expect(listCommits[0].parents).toEqual(['a', 'b']);
		expect(listCommits[1].parents).toEqual([]);
	});

	it('ignores blank lines and empty output', () => {
		expect(parseLog('')).toEqual([]);
		expect(parseLog('\n\n')).toEqual([]);
	});
});
