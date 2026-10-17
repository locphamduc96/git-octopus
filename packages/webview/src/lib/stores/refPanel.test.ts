import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefPanelData } from '@git-octopus/shared';

async function load() {
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: () => {},
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { refPanel } = await import('./refPanel.svelte');
	const { dispatchHostMessage } = await import('../hostRouter');
	return { refPanel, dispatchHostMessage };
}

const DATA: RefPanelData = {
	listLocal: [{ name: 'main', hash: 'a'.repeat(40) }],
	listRemote: [],
	listTags: [],
	listStashes: [],
	current: 'main',
};

describe('ref panel store', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('holds nothing before the host sends the refs', async () => {
		const { refPanel } = await load();
		expect(refPanel.data).toBeNull();
		expect(refPanel.repoPath).toBeNull();
	});

	it('keeps the latest refs and the repository they belong to', async () => {
		const { refPanel, dispatchHostMessage } = await load();

		expect(dispatchHostMessage({ type: 'refPanel', repoPath: '/repo/a', data: DATA })).toBe(true);
		expect(refPanel.data).toEqual(DATA);
		expect(refPanel.repoPath).toBe('/repo/a');

		const next = { ...DATA, current: null };
		dispatchHostMessage({ type: 'refPanel', repoPath: '/repo/b', data: next });
		expect(refPanel.data).toEqual(next);
		expect(refPanel.repoPath).toBe('/repo/b');
	});
});
