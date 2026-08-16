import { describe, expect, it } from 'vitest';
import type { BranchInventoryEntry } from '@git-octopus/shared';
import {
	buildCleanupRows,
	defaultSelection,
	describeEntry,
	monthsBetween,
	needsForce,
} from './branchCleanup';

const NOW = new Date('2026-08-16T12:00:00Z');

function entry(overrides: Partial<BranchInventoryEntry> = {}): BranchInventoryEntry {
	return {
		name: 'feature/x',
		hash: 'a'.repeat(40),
		subject: 'Subject',
		committedAt: '2026-01-16T12:00:00Z',
		merged: true,
		upstreamGone: false,
		current: false,
		...overrides,
	};
}

describe('monthsBetween', () => {
	it('counts a month only once the day of month comes round', () => {
		expect(monthsBetween('2026-05-16T12:00:00Z', NOW)).toBe(3);
		expect(monthsBetween('2026-05-17T12:00:00Z', NOW)).toBe(2);
	});

	it('floors at zero for a future or unparseable date', () => {
		expect(monthsBetween('2026-12-01T00:00:00Z', NOW)).toBe(0);
		expect(monthsBetween('not a date', NOW)).toBe(0);
	});
});

describe('describeEntry', () => {
	it('ticks an old merged branch by default', () => {
		const row = describeEntry(entry(), { now: NOW });
		expect(row.selectable).toBe(true);
		expect(row.defaultChecked).toBe(true);
		expect(row.reason).toBe('');
	});

	it('locks the checked-out branch', () => {
		const row = describeEntry(entry({ name: 'wip', current: true }), { now: NOW });
		expect(row.selectable).toBe(false);
		expect(row.reason).toBe('checked out');
	});

	it('locks protected trunks', () => {
		for (const name of ['main', 'master', 'develop', 'dev']) {
			expect(describeEntry(entry({ name }), { now: NOW }).selectable).toBe(false);
		}
	});

	it('offers an unmerged branch but never ticks it', () => {
		const row = describeEntry(entry({ merged: false }), { now: NOW });
		expect(row.selectable).toBe(true);
		expect(row.defaultChecked).toBe(false);
		expect(row.reason).toContain('not merged');
	});

	it('calls out a deleted upstream', () => {
		expect(describeEntry(entry({ upstreamGone: true }), { now: NOW }).reason).toBe(
			'upstream deleted'
		);
	});
});

describe('buildCleanupRows', () => {
	it('keeps branches at or past the threshold and drops younger ones', () => {
		const listRows = buildCleanupRows(
			[
				entry({ name: 'old', committedAt: '2025-08-16T12:00:00Z' }),
				entry({ name: 'exactly-three', committedAt: '2026-05-16T12:00:00Z' }),
				entry({ name: 'young', committedAt: '2026-08-01T12:00:00Z' }),
			],
			{ now: NOW, months: 3 }
		);
		expect(listRows.map((row) => row.entry.name)).toEqual(['old', 'exactly-three']);
	});

	it('sorts oldest first, then by name', () => {
		const listRows = buildCleanupRows(
			[
				entry({ name: 'b', committedAt: '2026-01-16T12:00:00Z' }),
				entry({ name: 'a', committedAt: '2026-01-16T12:00:00Z' }),
				entry({ name: 'ancient', committedAt: '2024-01-16T12:00:00Z' }),
			],
			{ now: NOW, months: 1 }
		);
		expect(listRows.map((row) => row.entry.name)).toEqual(['ancient', 'a', 'b']);
	});

	it('still lists a protected branch that is old enough', () => {
		const listRows = buildCleanupRows([entry({ name: 'main' })], { now: NOW, months: 1 });
		expect(listRows).toHaveLength(1);
		expect(listRows[0].selectable).toBe(false);
	});
});

describe('defaultSelection and needsForce', () => {
	it('pre-selects only the merged, unlocked branches', () => {
		const listRows = buildCleanupRows(
			[
				entry({ name: 'merged' }),
				entry({ name: 'unmerged', merged: false }),
				entry({ name: 'main' }),
			],
			{ now: NOW, months: 1 }
		);
		expect([...defaultSelection(listRows)]).toEqual(['merged']);
	});

	it('needs force only when an unmerged branch is picked', () => {
		const listRows = buildCleanupRows(
			[entry({ name: 'merged' }), entry({ name: 'unmerged', merged: false })],
			{ now: NOW, months: 1 }
		);
		expect(needsForce(listRows, new Set(['merged']))).toBe(false);
		expect(needsForce(listRows, new Set(['merged', 'unmerged']))).toBe(true);
	});
});
