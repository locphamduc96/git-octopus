import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';
import { LIST_ROUTED_BY_STORE, listRoutedTypes } from '../hostRouter';

/**
 * `App.svelte` trusts `LIST_ROUTED_BY_STORE`: the types on that list are the ones its `default` arm
 * accepts without handling, which is what keeps a genuinely unhandled protocol message a compile
 * error. A type listed here and then never registered would go quietly unanswered at runtime —
 * exactly the failure the exhaustiveness check used to rule out.
 */
beforeAll(async () => {
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: () => {},
		getState: () => undefined,
		setState: () => undefined,
	}));
	// Registration happens on import, the same way `App.svelte` does it.
	await import('./branchCleanup.svelte');
	await import('./diffView.svelte');
	await import('./identity.svelte');
	await import('./prefs.svelte');
});

describe('store ownership', () => {
	it('registers a handler for every type it claims', () => {
		const listRegistered = listRoutedTypes();
		const listMissing = LIST_ROUTED_BY_STORE.filter((type) => !listRegistered.includes(type));

		expect(listMissing).toEqual([]);
	});

	it('claims every type it registers, so App.svelte is never asked to accept a surprise', () => {
		const listClaimed: readonly HostToWebview['type'][] = LIST_ROUTED_BY_STORE;
		const listUnclaimed = listRoutedTypes().filter((type) => !listClaimed.includes(type));

		expect(listUnclaimed).toEqual([]);
	});
});
