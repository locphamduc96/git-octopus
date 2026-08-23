import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

const inventory = {
	type: 'branchInventory',
	listBranches: [
		{ name: 'feature/a', hash: 'aaa1111', merged: true, ahead: 0, behind: 0, upstream: null },
		{ name: 'feature/b', hash: 'bbb2222', merged: true, ahead: 0, behind: 0, upstream: null },
	],
	mergedBase: 'main',
} as unknown as HostToWebview;

async function loadCleanup() {
	const listSent: { type: string; [key: string]: unknown }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message as { type: string }),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { branchCleanup } = await import('./branchCleanup.svelte');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	return { branchCleanup, listSent, dispatchHostMessage, resetForRepo };
}

describe('branchCleanup', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('opens on a fresh scan rather than the list from last time', async () => {
		const { branchCleanup, listSent, dispatchHostMessage } = await loadCleanup();
		dispatchHostMessage(inventory);
		branchCleanup.openDialog();

		// A stale list would offer to delete a branch that has since been pushed to.
		expect(branchCleanup.loading).toBe(true);
		expect(branchCleanup.listBranches).toEqual([]);
		expect(listSent.map((message) => message.type)).toEqual(['loadBranchInventory']);
	});

	it('pins the tips of exactly the branches being deleted', async () => {
		const { branchCleanup, listSent, dispatchHostMessage } = await loadCleanup();
		branchCleanup.openDialog();
		dispatchHostMessage(inventory);
		branchCleanup.deleteBranches(['feature/a'], false);

		const request = listSent.at(-1) as unknown as { mapExpectedTips: Record<string, string> };
		expect(request.mapExpectedTips).toEqual({ 'feature/a': 'aaa1111' });
	});

	it('closes and forgets everything when the view moves to another repository', async () => {
		const { branchCleanup, dispatchHostMessage, resetForRepo } = await loadCleanup();
		branchCleanup.openDialog();
		dispatchHostMessage(inventory);
		dispatchHostMessage({
			type: 'branchCleanupResult',
			listResults: [{ name: 'feature/a', deleted: true }],
		} as unknown as HostToWebview);

		resetForRepo();
		expect(branchCleanup.open).toBe(false);
		expect(branchCleanup.listResults).toBeNull();
		expect(branchCleanup.listBranches).toEqual([]);
	});
});
