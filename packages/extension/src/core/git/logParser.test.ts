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
		expect(parseRefs('HEAD -> refs/heads/main')).toEqual([
			{ kind: 'head' },
			{ kind: 'branch', name: 'main' },
		]);
	});

	it('keeps the remote separate from the branch name', () => {
		expect(parseRefs('refs/remotes/origin/main')).toEqual([
			{ kind: 'branch', name: 'main', remote: 'origin' },
		]);
	});

	it('reads tags', () => {
		expect(parseRefs('tag: refs/tags/v1.2.0')).toEqual([{ kind: 'tag', name: 'v1.2.0' }]);
	});

	it('treats a local branch containing a slash as local, not remote', () => {
		expect(parseRefs('refs/heads/feature/ZG-2375_friend')).toEqual([
			{ kind: 'branch', name: 'feature/ZG-2375_friend' },
		]);
	});

	it('keeps the whole path after the remote name', () => {
		expect(parseRefs('refs/remotes/origin/feature/ZG-2375_friend')).toEqual([
			{ kind: 'branch', name: 'feature/ZG-2375_friend', remote: 'origin' },
		]);
	});

	it('drops <remote>/HEAD, which only mirrors the remote default branch', () => {
		expect(parseRefs('refs/remotes/origin/HEAD')).toEqual([]);
	});

	it('ignores git-internal refs such as refs/stash', () => {
		expect(parseRefs('refs/stash')).toEqual([]);
		expect(parseRefs('refs/notes/commits')).toEqual([]);
	});

	it('reads a full decoration line', () => {
		expect(
			parseRefs(
				'HEAD -> refs/heads/feature/ZG-2375_friend, tag: refs/tags/v1.0, ' +
					'refs/remotes/origin/feature/ZG-2375_friend, refs/remotes/origin/HEAD, refs/heads/main'
			)
		).toEqual([
			{ kind: 'head' },
			{ kind: 'branch', name: 'feature/ZG-2375_friend' },
			{ kind: 'tag', name: 'v1.0' },
			{ kind: 'branch', name: 'feature/ZG-2375_friend', remote: 'origin' },
			{ kind: 'branch', name: 'main' },
		]);
	});

	it('marks a detached HEAD', () => {
		expect(parseRefs('HEAD')).toEqual([{ kind: 'head' }]);
	});
});
