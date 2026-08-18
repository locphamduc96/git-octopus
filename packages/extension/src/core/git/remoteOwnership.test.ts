import { describe, expect, it } from 'vitest';
import { listCandidateRemotes, remoteIsAmbiguous } from './remoteOwnership.js';

describe('listCandidateRemotes', () => {
	it('names the one remote that owns an ordinary ref', () => {
		expect(listCandidateRemotes('refs/remotes/origin/main', ['origin', 'upstream'])).toEqual([
			'origin',
		]);
	});

	it('names both remotes when their names overlap on the same path', () => {
		// `team/origin`'s `main`, or `team`'s branch called `origin/main` — the ref path is the same
		// either way, and the last fetch wins it.
		expect(listCandidateRemotes('refs/remotes/team/origin/main', ['team', 'team/origin'])).toEqual([
			'team/origin',
			'team',
		]);
	});

	it('does not treat a remote as owning its own root', () => {
		// `refs/remotes/origin` is the remote, not a branch under it.
		expect(listCandidateRemotes('refs/remotes/origin/', ['origin'])).toEqual([]);
	});

	it('ignores remotes that merely share a name prefix without a path boundary', () => {
		// `team` does not own `teamwork/main`; only a whole path segment counts.
		expect(listCandidateRemotes('refs/remotes/teamwork/main', ['team'])).toEqual([]);
	});

	it('answers nothing for a path that is not a remote-tracking ref', () => {
		expect(listCandidateRemotes('refs/heads/main', ['origin'])).toEqual([]);
	});
});

describe('remoteIsAmbiguous', () => {
	it('is false when exactly one remote can own the ref', () => {
		expect(remoteIsAmbiguous('refs/remotes/origin/main', ['origin', 'upstream'])).toBe(false);
	});

	it('is true when two configured remotes both can', () => {
		expect(remoteIsAmbiguous('refs/remotes/team/origin/main', ['team', 'team/origin'])).toBe(true);
	});

	it('is false when the overlapping remote is not configured any more', () => {
		// Removing one of the two settles the question, so the action may proceed.
		expect(remoteIsAmbiguous('refs/remotes/team/origin/main', ['team/origin'])).toBe(false);
	});
});
