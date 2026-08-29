import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import type { BranchInventoryEntry } from '@git-octopus/shared';
import BranchCleanupDialog from './BranchCleanupDialog.svelte';

function isoMonthsAgo(months: number): string {
	const date = new Date();
	// First of the month, so monthsBetween never docks a month for a day-of-month not yet reached.
	date.setDate(1);
	date.setMonth(date.getMonth() - months);
	return date.toISOString();
}

function entry(partial: Partial<BranchInventoryEntry> & { name: string }): BranchInventoryEntry {
	return {
		hash: 'abc123',
		subject: 'subject',
		committedAt: isoMonthsAgo(8),
		merged: true,
		upstreamGone: false,
		current: false,
		...partial,
	};
}

const OLD_MERGED = entry({ name: 'old-merged' });
const OLD_UNMERGED = entry({ name: 'old-unmerged', committedAt: isoMonthsAgo(9), merged: false });
const MID_MERGED = entry({ name: 'mid-merged', committedAt: isoMonthsAgo(4) });
const CURRENT = entry({ name: 'current-branch', committedAt: isoMonthsAgo(10), current: true });

function mount(listBranches: BranchInventoryEntry[]) {
	const ondelete = vi.fn();
	const onclose = vi.fn();
	render(BranchCleanupDialog, {
		listBranches,
		mergedBase: 'main',
		loading: false,
		listResults: null,
		ondelete,
		onclose,
	});
	return { ondelete, onclose };
}

const box = (name: string): HTMLInputElement =>
	screen.getByRole('checkbox', { name: new RegExp(name) });

describe('BranchCleanupDialog', () => {
	it('opens with merged rows ticked, unmerged offered untucked, the checked-out row locked', () => {
		mount([OLD_MERGED, OLD_UNMERGED, CURRENT]);
		expect(box('old-merged').checked).toBe(true);
		expect(box('old-unmerged').checked).toBe(false);
		expect(box('current-branch').disabled).toBe(true);
	});

	it('keeps every hand-made choice when the threshold changes, ticking only unseen rows', async () => {
		const user = userEvent.setup();
		mount([OLD_MERGED, OLD_UNMERGED, MID_MERGED]);
		// mid-merged (4mo) is outside the default 6-month threshold.
		expect(screen.queryByRole('checkbox', { name: /mid-merged/ })).toBeNull();

		// The user's own verdicts: untick a default, tick an unmerged branch.
		await user.click(box('old-merged'));
		await user.click(box('old-unmerged'));

		await user.click(screen.getByRole('button', { name: '3mo' }));
		// The row the new threshold revealed gets the default ticking…
		expect(box('mid-merged').checked).toBe(true);
		// …while everything already judged keeps the user's word over the default's.
		expect(box('old-merged').checked).toBe(false);
		expect(box('old-unmerged').checked).toBe(true);
	});

	it('deletes only after the second, danger-labelled step — Force delete once unmerged work is in', async () => {
		const user = userEvent.setup();
		const { ondelete } = mount([OLD_MERGED, OLD_UNMERGED]);
		await user.click(box('old-unmerged'));

		await user.click(screen.getByRole('button', { name: /Delete 2 branches/ }));
		expect(ondelete).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: 'Force delete' }));
		expect(ondelete).toHaveBeenCalledExactlyOnceWith(['old-unmerged', 'old-merged'], true);
	});

	it('backs out of the confirm step without deleting anything', async () => {
		const user = userEvent.setup();
		const { ondelete } = mount([OLD_MERGED]);
		await user.click(screen.getByRole('button', { name: /Delete 1 branch/ }));
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(ondelete).not.toHaveBeenCalled();
		// Back on the picker: the first-step button is there again.
		expect(screen.getByRole('button', { name: /Delete 1 branch/ })).toBeTruthy();
	});
});
