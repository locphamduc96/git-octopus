import { describe, expect, it } from 'vitest';
import type { GraphFilters } from '@git-octopus/shared';
import { buildHostFilters, commitsReplyMatches, loadSignature } from './commitsGuard';
import { DEFAULT_VIEW_SETTINGS } from './viewSettings';

const wanted: GraphFilters = buildHostFilters(DEFAULT_VIEW_SETTINGS);

describe('buildHostFilters', () => {
	it('carries every walk-affecting setting and pins branch to null', () => {
		const filters = buildHostFilters({
			...DEFAULT_VIEW_SETTINGS,
			showRemoteBranches: false,
			fetchAvatars: true,
			commitOrder: 'topo',
			showTags: false,
			showStashes: false,
			showUncommitted: false,
		});
		expect(filters).toEqual({
			branch: null,
			showRemoteBranches: false,
			fetchAvatars: true,
			commitOrder: 'topo',
			showTags: false,
			showStashes: false,
			showUncommitted: false,
		});
	});
});

describe('commitsReplyMatches', () => {
	it('drops a reply carrying less history than the view already has', () => {
		expect(commitsReplyMatches({ limit: 300, filters: wanted }, wanted, 600)).toBe(false);
		expect(commitsReplyMatches({ limit: 600, filters: wanted }, wanted, 600)).toBe(true);
		expect(commitsReplyMatches({ limit: 900, filters: wanted }, wanted, 600)).toBe(true);
	});

	it('accepts a reply that does not say what it was asked with', () => {
		expect(commitsReplyMatches({}, wanted, 300)).toBe(true);
		expect(commitsReplyMatches({ limit: undefined }, wanted, 300)).toBe(true);
	});

	it('drops a reply whose echoed filters differ in any field', () => {
		const listStale: Partial<GraphFilters>[] = [
			{ showRemoteBranches: !wanted.showRemoteBranches },
			{ fetchAvatars: !wanted.fetchAvatars },
			{ commitOrder: 'topo' },
			{ showTags: !wanted.showTags },
			{ showStashes: !wanted.showStashes },
			{ showUncommitted: !wanted.showUncommitted },
		];
		for (const stale of listStale) {
			expect(commitsReplyMatches({ filters: { ...wanted, ...stale } }, wanted, 300)).toBe(false);
		}
	});

	it('reads missing optional fields as their protocol defaults', () => {
		// The reply omits every optional field; the view wants exactly the defaults → match.
		const echoed: GraphFilters = { branch: null, showRemoteBranches: true };
		expect(commitsReplyMatches({ filters: echoed }, wanted, 300)).toBe(true);
		// Wanting avatars while the echo is silent about them → the echo means "off" → stale.
		const wantsAvatars = buildHostFilters({ ...DEFAULT_VIEW_SETTINGS, fetchAvatars: true });
		expect(commitsReplyMatches({ filters: echoed }, wantsAvatars, 300)).toBe(false);
	});
});

describe('loadSignature', () => {
	it('is stable for identical input and differs when anything changes', () => {
		expect(loadSignature(300, wanted)).toBe(loadSignature(300, { ...wanted }));
		expect(loadSignature(300, wanted)).not.toBe(loadSignature(600, wanted));
		expect(loadSignature(300, wanted)).not.toBe(
			loadSignature(300, { ...wanted, showTags: !wanted.showTags })
		);
	});
});
