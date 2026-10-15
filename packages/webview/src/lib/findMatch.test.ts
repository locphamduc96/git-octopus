import type { Commit, GraphRow, Ref } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import { buildMatcher, listMatchHashes, stepMatch, type FindMatcher } from './findMatch';

function commit(hash: string, subject: string, over: Partial<Commit> = {}): Commit {
	return {
		hash,
		parents: [],
		author: { name: 'Ada Lovelace', email: 'ada@example.com' },
		committedAt: 0,
		authoredAt: 0,
		subject,
		refs: [],
		...over,
	};
}

function row(c: Commit): GraphRow {
	return {
		commit: c,
		nodeColumn: 0,
		nodeColour: 0,
		nodeBranch: 0,
		listInputLanes: [],
		listOutputLanes: [],
		listParentColumns: [],
	};
}

function test(matcher: FindMatcher | null, c: Commit): boolean {
	if (matcher === null || 'error' in matcher) throw new Error('no matcher');
	return matcher.test(c);
}

const OFF = { matchCase: false, regex: false };

describe('buildMatcher', () => {
	it('is null for an empty or blank query', () => {
		expect(buildMatcher('', OFF)).toBeNull();
		expect(buildMatcher('   ', OFF)).toBeNull();
	});

	it('finds the subject, the author name and the author email, ignoring case by default', () => {
		const c = commit('abc12345', 'Fix the Week picker');
		expect(test(buildMatcher('week', OFF), c)).toBe(true);
		expect(test(buildMatcher('lovelace', OFF), c)).toBe(true);
		expect(test(buildMatcher('ada@example', OFF), c)).toBe(true);
		expect(test(buildMatcher('nothing', OFF), c)).toBe(false);
	});

	it('respects match case', () => {
		const c = commit('abc12345', 'Fix the Week picker');
		expect(test(buildMatcher('week', { matchCase: true, regex: false }), c)).toBe(false);
		expect(test(buildMatcher('Week', { matchCase: true, regex: false }), c)).toBe(true);
	});

	it('finds branch, remote branch and tag names, but not HEAD', () => {
		const listRefs: Ref[] = [
			{ kind: 'head' },
			{ kind: 'branch', name: 'feature/login' },
			{ kind: 'branch', name: 'main', remote: 'origin' },
			{ kind: 'tag', name: 'v1.2.0' },
		];
		const c = commit('abc12345', 'subject', { refs: listRefs });
		expect(test(buildMatcher('feature/log', OFF), c)).toBe(true);
		expect(test(buildMatcher('origin/main', OFF), c)).toBe(true);
		expect(test(buildMatcher('v1.2', OFF), c)).toBe(true);
		expect(test(buildMatcher('head', OFF), c)).toBe(false);
	});

	it('matches a hash by prefix whatever the case or regex setting', () => {
		const c = commit('a1b2c3d4e5', 'subject');
		expect(test(buildMatcher('A1B2', { matchCase: true, regex: true }), c)).toBe(true);
		expect(test(buildMatcher('b2c3', OFF), c)).toBe(false);
	});

	it('runs a regex, and reports an unfinished one instead of throwing', () => {
		const c = commit('abc12345', 'feat(auth): social login');
		expect(test(buildMatcher('^feat\\(', { matchCase: false, regex: true }), c)).toBe(true);
		expect(buildMatcher('feat(', { matchCase: false, regex: true })).toEqual({
			error: 'Invalid regex',
		});
	});

	it('never matches the Uncommitted row', () => {
		const c = commit('*uncommitted*', 'Uncommitted Changes (3)', { isUncommitted: true });
		expect(test(buildMatcher('changes', OFF), c)).toBe(false);
	});
});

describe('listMatchHashes', () => {
	it('keeps graph order and is empty for no matcher or an error', () => {
		const rows = [
			row(commit('a1', 'one fix')),
			row(commit('a2', 'two')),
			row(commit('a3', 'fix three')),
		];
		expect(listMatchHashes(rows, buildMatcher('fix', OFF))).toEqual(['a1', 'a3']);
		expect(listMatchHashes(rows, null)).toEqual([]);
		expect(listMatchHashes(rows, { error: 'Invalid regex' })).toEqual([]);
	});
});

describe('stepMatch', () => {
	const listOrder = ['r0', 'r1', 'r2', 'r3', 'r4'];
	const listMatches = ['r1', 'r3'];

	it('moves to the next and previous match, wrapping at both ends', () => {
		expect(stepMatch(listMatches, 'r1', 1)).toBe('r3');
		expect(stepMatch(listMatches, 'r3', 1)).toBe('r1');
		expect(stepMatch(listMatches, 'r1', -1)).toBe('r3');
	});

	it('starts from the selected commit when there is no current match', () => {
		expect(stepMatch(listMatches, null, 1, listOrder, 'r2')).toBe('r3');
		expect(stepMatch(listMatches, null, -1, listOrder, 'r2')).toBe('r1');
		expect(stepMatch(listMatches, null, 1, listOrder, 'r3')).toBe('r3');
	});

	it('falls back to the first or last match with no anchor, and to null with no matches', () => {
		expect(stepMatch(listMatches, null, 1)).toBe('r1');
		expect(stepMatch(listMatches, null, -1)).toBe('r3');
		expect(stepMatch([], null, 1)).toBeNull();
	});
});
