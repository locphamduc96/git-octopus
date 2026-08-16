import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewToHost } from '@git-octopus/shared';

/**
 * The bridge grabs the VS Code API at import time, so the stub has to be in place first — and the
 * stub has to *clone*, because that is the part of `postMessage` that used to reject our messages.
 */
async function loadBridge(postMessage: (message: unknown) => void) {
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage,
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	return import('./index');
}

describe('postToHost', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a message that survives a structured clone', async () => {
		const listSent: unknown[] = [];
		const { postToHost } = await loadBridge((message) => listSent.push(structuredClone(message)));

		// Svelte's `$state` hands out proxies. A proxy cannot be structure-cloned, so posting one
		// throws inside `postMessage`: the message never arrives and the caller dies with it.
		const proxied = new Proxy({ highlightBranchOnHover: false }, {});
		const message = {
			type: 'saveViewSettings',
			settings: { settings: proxied },
		} as unknown as WebviewToHost;

		expect(() => postToHost(message)).not.toThrow();
		expect(listSent).toEqual([
			{ type: 'saveViewSettings', settings: { settings: { highlightBranchOnHover: false } } },
		]);
	});

	it('leaves an ordinary message untouched', async () => {
		const listSent: unknown[] = [];
		const { postToHost } = await loadBridge((message) => listSent.push(message));
		postToHost({ type: 'loadCommits', limit: 300 });
		expect(listSent).toEqual([{ type: 'loadCommits', limit: 300 }]);
	});
});
