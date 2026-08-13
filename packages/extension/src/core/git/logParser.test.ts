import { describe, expect, it } from 'vitest';
import { parseLog, parseRefs } from './logParser.js';

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

describe('parseRefs', () => {
	it('splits the checked-out branch into a head marker and the branch itself', () => {
		expect(parseRefs('HEAD -> main')).toEqual([
			{ kind: 'head' },
			{ kind: 'branch', name: 'main' },
		]);
	});

	it('keeps the remote separate from the branch name', () => {
		expect(parseRefs('origin/main')).toEqual([
			{ kind: 'branch', name: 'main', remote: 'origin' },
		]);
	});

	it('reads tags', () => {
		expect(parseRefs('tag: v1.2.0')).toEqual([{ kind: 'tag', name: 'v1.2.0' }]);
	});

	it('drops <remote>/HEAD, which only mirrors the remote default branch', () => {
		expect(parseRefs('HEAD -> main, origin/main, origin/HEAD')).toEqual([
			{ kind: 'head' },
			{ kind: 'branch', name: 'main' },
			{ kind: 'branch', name: 'main', remote: 'origin' },
		]);
	});

	it('ignores git-internal refs printed in full, such as refs/stash', () => {
		expect(parseRefs('refs/stash')).toEqual([]);
		expect(parseRefs('refs/notes/commits')).toEqual([]);
	});

	it('keeps a real branch that merely ends in HEAD', () => {
		expect(parseRefs('origin/feature/HEADless')).toEqual([
			{ kind: 'branch', name: 'feature/HEADless', remote: 'origin' },
		]);
	});
});
