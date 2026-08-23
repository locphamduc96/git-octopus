import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

/**
 * The bridge grabs the VS Code API at import time and the store registers its handler at import
 * time, so both have to be loaded after the stub — and freshly per test, since the state is module
 * scope by design.
 */
async function loadPrefs() {
	const listSent: unknown[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { prefs } = await import('./prefs.svelte');
	const { dispatchHostMessage } = await import('../hostRouter');
	const send = (settings: Record<string, unknown> | null) =>
		dispatchHostMessage({ type: 'viewSettings', settings } as HostToWebview);
	return { prefs, send, listSent };
}

describe('prefs', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('saves nothing before the host has said what it holds', async () => {
		const { prefs, listSent } = await loadPrefs();
		prefs.setFileView('list');
		prefs.save();
		// Posting here would store this view's defaults over the preferences every other window has.
		expect(listSent).toEqual([]);
	});

	it('writes the defaults once when the host holds nothing', async () => {
		const { send, listSent } = await loadPrefs();
		send(null);
		expect(listSent).toHaveLength(1);
		expect((listSent[0] as { type: string }).type).toBe('saveViewSettings');
	});

	it('takes the stored preferences without answering them back', async () => {
		const { prefs, send, listSent } = await loadPrefs();
		send({ fileView: 'list', metaOpen: true });

		expect(prefs.fileView).toBe('list');
		expect(prefs.metaOpen).toBe(true);
		// Two open panels each receive the other's save; answering an unchanged value never ends.
		prefs.save();
		expect(listSent).toEqual([]);
	});

	it('saves once the user actually changes something', async () => {
		const { prefs, send, listSent } = await loadPrefs();
		send({ fileView: 'list' });
		prefs.setFileView('tree');
		prefs.save();
		expect(listSent).toHaveLength(1);
	});

	it('tells the graph the stored settings landed, so it can re-ask with them', async () => {
		const { prefs, send } = await loadPrefs();
		let loaded = 0;
		prefs.onLoaded(() => (loaded += 1));

		send({ commitLimit: 500 });
		expect(loaded).toBe(1);
	});

	it('leaves the graph alone when the host holds nothing to re-ask with', async () => {
		const { prefs, send } = await loadPrefs();
		let loaded = 0;
		prefs.onLoaded(() => (loaded += 1));

		send(null);
		expect(loaded).toBe(0);
	});

	it('flips one column without disturbing the others', async () => {
		const { prefs } = await loadPrefs();
		const before = prefs.columns;
		prefs.toggleColumn('author');

		expect(prefs.columns.author).toBe(!before.author);
		expect(prefs.columns.date).toBe(before.date);
	});

	it('resizes one column only', async () => {
		const { prefs } = await loadPrefs();
		const refWidth = prefs.widths.ref;
		prefs.resizeColumn('date', 200);

		expect(prefs.widths.date).toBe(200);
		expect(prefs.widths.ref).toBe(refWidth);
	});
});
