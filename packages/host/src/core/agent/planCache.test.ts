import { describe, expect, it } from 'vitest';
import { PlanCache } from './planCache.js';

describe('PlanCache', () => {
	it('remembers a finished run for the repository that ran it', () => {
		const cache = new PlanCache();
		const id = cache.begin('/repo');
		expect(cache.get('/repo')).toEqual({ generationId: id, status: 'running' });

		cache.complete('/repo', id, { plan: { listGroups: [], single: { subject: 's' } } });
		expect(cache.get('/repo')?.status).toBe('done');
		expect(cache.get('/other')).toBeNull();
	});

	it('issues monotonic ids across repositories, so they work as process keys', () => {
		const cache = new PlanCache();
		const a = cache.begin('/a');
		const b = cache.begin('/b');
		expect(b).toBeGreaterThan(a);
	});

	it('refuses a superseded result — the newer run owns the slot', () => {
		const cache = new PlanCache();
		const old = cache.begin('/repo');
		const fresh = cache.begin('/repo');

		expect(cache.complete('/repo', old, { error: 'late' })).toBe(false);
		expect(cache.get('/repo')).toEqual({ generationId: fresh, status: 'running' });
	});

	it('clears only the run it was asked to clear', () => {
		const cache = new PlanCache();
		const old = cache.begin('/repo');
		const fresh = cache.begin('/repo');

		cache.clear('/repo', old);
		expect(cache.get('/repo')?.generationId).toBe(fresh);
		cache.clear('/repo');
		expect(cache.get('/repo')).toBeNull();
	});

	it('names the running id for a cancel, and only while it is actually running', () => {
		const cache = new PlanCache();
		const id = cache.begin('/repo');
		expect(cache.runningId('/repo')).toBe(id);
		cache.complete('/repo', id, { error: 'x' });
		expect(cache.runningId('/repo')).toBeNull();
	});
});
