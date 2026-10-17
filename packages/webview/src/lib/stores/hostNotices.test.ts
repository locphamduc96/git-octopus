import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

async function load() {
	const listSent: { type: string; [key: string]: unknown }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: { type: string }) => listSent.push(message),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { hostNotices } = await import('./hostNotices.svelte');
	const { capabilities } = await import('./capabilities.svelte');
	const { dispatchHostMessage } = await import('../hostRouter');
	const send = (message: HostToWebview) => dispatchHostMessage(message);
	return { hostNotices, capabilities, send, listSent };
}

describe('host notices', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('lets a plain notice go by itself, and answers nothing for it', async () => {
		const { hostNotices, send, listSent } = await load();
		send({ type: 'hostNotice', id: 1, level: 'info', message: 'done', listActions: [] });
		expect(hostNotices.list).toHaveLength(1);
		vi.advanceTimersByTime(10_000);
		expect(hostNotices.list).toEqual([]);
		expect(listSent).toEqual([]);
	});

	it('keeps a notice that asks something until it is answered, then sends the answer', async () => {
		const { hostNotices, send, listSent } = await load();
		send({ type: 'hostNotice', id: 7, level: 'error', message: 'lock', listActions: ['Remove'] });
		vi.advanceTimersByTime(60_000);
		expect(hostNotices.list).toHaveLength(1);
		hostNotices.answer(7, 'Remove');
		expect(hostNotices.list).toEqual([]);
		expect(listSent).toEqual([{ type: 'hostNoticeReply', id: 7, action: 'Remove' }]);
	});

	it('shows a task while it runs, updates its line, and lets it be cancelled', async () => {
		const { hostNotices, send, listSent } = await load();
		const base = { type: 'hostProgress', id: 3, title: 'Fetching', cancellable: true } as const;
		send({ ...base, done: false });
		send({ ...base, message: 'origin', done: false });
		expect(hostNotices.tasks).toEqual([
			{ id: 3, title: 'Fetching', message: 'origin', cancellable: true },
		]);
		hostNotices.cancel(3);
		expect(listSent).toEqual([{ type: 'hostProgressCancel', id: 3 }]);
		send({ ...base, done: true });
		expect(hostNotices.tasks).toEqual([]);
	});
});

describe('capabilities', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("assumes VS Code's until the host says otherwise", async () => {
		const { capabilities, send } = await load();
		expect([capabilities.desktop, capabilities.editorDiff]).toEqual([false, true]);
		send({ type: 'capabilities', desktop: true, editorDiff: false });
		expect([capabilities.desktop, capabilities.editorDiff]).toEqual([true, false]);
	});
});
