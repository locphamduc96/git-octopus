import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

const file = { path: 'src/app.ts', title: 'abc12345', hash: 'abc1234567' };

function hunk(text: string) {
	return {
		header: '@@ -1 +1 @@',
		listLines: [{ kind: 'context', text, oldLine: 1, newLine: 1 }],
	};
}

async function loadDiffView() {
	const listSent: { type: string; [key: string]: unknown }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message as { type: string }),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { diffView } = await import('./diffView.svelte');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	const lastKey = () => String((listSent.at(-1) as { key?: string }).key);
	return { diffView, listSent, dispatchHostMessage, resetForRepo, lastKey };
}

describe('diffView', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('asks the host for the file it was told to show', async () => {
		const { diffView, listSent } = await loadDiffView();
		diffView.show(file);

		expect(diffView.target).toEqual(file);
		expect(diffView.loading).toBe(true);
		expect(listSent.map((message) => message.type)).toEqual(['loadFileDiff']);
	});

	it('takes the reply meant for the file on screen', async () => {
		const { diffView, dispatchHostMessage, lastKey } = await loadDiffView();
		diffView.show(file);
		dispatchHostMessage({
			type: 'fileDiff',
			key: lastKey(),
			listHunks: [hunk('mine')],
		} as unknown as HostToWebview);

		expect(diffView.loading).toBe(false);
		expect(diffView.listHunks).toHaveLength(1);
	});

	it('drops a reply for a file the user has already stepped past', async () => {
		const { diffView, dispatchHostMessage } = await loadDiffView();
		diffView.show(file);
		dispatchHostMessage({
			type: 'fileDiff',
			key: 'a key from two files ago',
			listHunks: [hunk('theirs')],
		} as unknown as HostToWebview);

		expect(diffView.listHunks).toEqual([]);
		expect(diffView.loading).toBe(true);
	});

	it('serves a file it has already fetched without asking again', async () => {
		const { diffView, listSent, dispatchHostMessage, lastKey } = await loadDiffView();
		diffView.show(file);
		dispatchHostMessage({
			type: 'fileDiff',
			key: lastKey(),
			listHunks: [hunk('mine')],
		} as unknown as HostToWebview);

		diffView.close();
		diffView.show(file);

		expect(listSent).toHaveLength(1);
		expect(diffView.loading).toBe(false);
		expect(diffView.listHunks).toHaveLength(1);
	});

	it('asks again with the new context when the mode changes', async () => {
		const { diffView, listSent, lastKey } = await loadDiffView();
		diffView.show(file);
		const compact = lastKey();
		diffView.setMode('full');

		expect(listSent).toHaveLength(2);
		expect(lastKey()).not.toBe(compact);
	});

	it('reports a failure on the panel instead of leaving it spinning', async () => {
		const { diffView } = await loadDiffView();
		diffView.show(file);
		diffView.failed('fatal: bad object');

		expect(diffView.loading).toBe(false);
		expect(diffView.notice).toBe('fatal: bad object');
	});

	it('closes the diff when the view moves to another repository', async () => {
		const { diffView, resetForRepo } = await loadDiffView();
		diffView.show(file);
		resetForRepo();

		expect(diffView.target).toBeNull();
	});
});
