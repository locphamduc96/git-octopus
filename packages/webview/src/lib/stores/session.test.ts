import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './session.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('session', () => {
	it('answers with the empty repo path until the host names a repository', () => {
		session.setActiveRepo(null);
		expect(session.activeRepo).toBeNull();
		expect(session.repoPath).toBe('');

		session.setActiveRepo('/repo');
		expect(session.repoPath).toBe('/repo');
	});

	it('clears a notice on its own, so a stale line never sits over the next repository', () => {
		session.showNotice('not in the loaded history');
		expect(session.notice).toBe('not in the loaded history');

		vi.advanceTimersByTime(4000);
		expect(session.notice).toBeNull();
	});

	it('restarts the clock for a second notice instead of letting the first one end it early', () => {
		session.showNotice('first');
		vi.advanceTimersByTime(3000);
		session.showNotice('second');

		vi.advanceTimersByTime(3000);
		expect(session.notice).toBe('second');

		vi.advanceTimersByTime(1000);
		expect(session.notice).toBeNull();
	});
});
