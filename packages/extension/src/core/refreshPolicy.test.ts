import { describe, expect, it } from 'vitest';
import { decideRefresh, heavier, needsFullReload, type RefreshState } from './refreshPolicy';

function state(overrides: Partial<RefreshState> = {}): RefreshState {
	return {
		enabled: true,
		hasWebview: true,
		visible: true,
		refreshing: false,
		missed: null,
		queued: null,
		...overrides,
	};
}

describe('heavier', () => {
	it('lets graph win over status, whichever side it is on', () => {
		expect(heavier('status', 'graph')).toBe('graph');
		expect(heavier('graph', 'status')).toBe('graph');
		expect(heavier(null, 'status')).toBe('status');
	});
});

describe('decideRefresh', () => {
	it('runs when the view is visible and idle', () => {
		expect(decideRefresh('status', state())).toEqual({ action: 'run', kind: 'status' });
	});

	it('drops the signal when auto-refresh is off', () => {
		expect(decideRefresh('graph', state({ enabled: false }))).toEqual({ action: 'drop' });
	});

	it('drops the signal when no webview is attached', () => {
		expect(decideRefresh('graph', state({ hasWebview: false }))).toEqual({ action: 'drop' });
	});

	it('defers while hidden instead of spending git calls nobody sees', () => {
		expect(decideRefresh('status', state({ visible: false }))).toEqual({
			action: 'defer',
			missed: 'status',
		});
	});

	it('keeps the heaviest kind missed while hidden', () => {
		expect(decideRefresh('status', state({ visible: false, missed: 'graph' }))).toEqual({
			action: 'defer',
			missed: 'graph',
		});
		expect(decideRefresh('graph', state({ visible: false, missed: 'status' }))).toEqual({
			action: 'defer',
			missed: 'graph',
		});
	});

	it('queues behind a running refresh rather than stacking git processes', () => {
		expect(decideRefresh('status', state({ refreshing: true }))).toEqual({
			action: 'queue',
			queued: 'status',
		});
	});

	it('collapses a burst into one queued entry, at the heaviest kind seen', () => {
		expect(decideRefresh('status', state({ refreshing: true, queued: 'graph' }))).toEqual({
			action: 'queue',
			queued: 'graph',
		});
	});

	it('checks visibility before business: a hidden view never queues', () => {
		expect(decideRefresh('graph', state({ visible: false, refreshing: true }))).toEqual({
			action: 'defer',
			missed: 'graph',
		});
	});
});

describe('needsFullReload', () => {
	const clean = { changeCount: 0, headHash: 'a'.repeat(40) };
	const dirty = { changeCount: 3, headHash: 'a'.repeat(40) };

	it('sends the status through when only the number of changes moved', () => {
		expect(needsFullReload(dirty, { ...dirty, changeCount: 5 })).toBe(false);
	});

	it('reloads when the uncommitted row has to appear', () => {
		expect(needsFullReload(clean, dirty)).toBe(true);
	});

	it('reloads when the uncommitted row has to disappear', () => {
		expect(needsFullReload(dirty, clean)).toBe(true);
	});

	it('reloads when HEAD moved, since the rows on screen are then stale', () => {
		expect(needsFullReload(dirty, { ...dirty, headHash: 'b'.repeat(40) })).toBe(true);
	});

	it('does not reload on the first status, when no HEAD was known yet', () => {
		expect(needsFullReload({ changeCount: 0, headHash: null }, clean)).toBe(false);
	});
});
