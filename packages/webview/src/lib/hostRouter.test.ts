import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';
import {
	dispatchHostMessage,
	listRoutedTypes,
	onHostType,
	onRepoReset,
	ownsGraph,
	resetForRepo,
} from './hostRouter';

const colorTheme = { type: 'colorTheme', kind: 'dark' } as const satisfies HostToWebview;

describe('hostRouter', () => {
	it('hands a message only to the handlers for its type', () => {
		const listSeen: string[] = [];
		const offTheme = onHostType('colorTheme', (message) => listSeen.push(`theme:${message.kind}`));
		const offIcons = onHostType('fileIcons', () => listSeen.push('icons'));

		expect(dispatchHostMessage(colorTheme)).toBe(true);
		expect(listSeen).toEqual(['theme:dark']);

		offTheme();
		offIcons();
	});

	it('runs every handler registered for one type, in registration order', () => {
		const listSeen: string[] = [];
		const offFirst = onHostType('colorTheme', () => listSeen.push('first'));
		const offSecond = onHostType('colorTheme', () => listSeen.push('second'));

		dispatchHostMessage(colorTheme);
		expect(listSeen).toEqual(['first', 'second']);

		offFirst();
		offSecond();
	});

	it('reports an unhandled type, which is what keeps App.svelte honest about ownership', () => {
		expect(dispatchHostMessage(colorTheme)).toBe(false);
	});

	it('stops calling a handler once it unsubscribes, leaving its siblings alone', () => {
		const listSeen: string[] = [];
		const offGone = onHostType('colorTheme', () => listSeen.push('gone'));
		const offKept = onHostType('colorTheme', () => listSeen.push('kept'));

		offGone();
		dispatchHostMessage(colorTheme);
		expect(listSeen).toEqual(['kept']);

		offKept();
	});

	it('leaves no type registered once every handler for it is gone', () => {
		const off = onHostType('colorTheme', () => {});
		expect(listRoutedTypes()).toContain('colorTheme');
		off();
		expect(listRoutedTypes()).not.toContain('colorTheme');
	});

	it('runs every repo-reset hook, so no domain is left holding the old repository', () => {
		const listSeen: string[] = [];
		onRepoReset(() => listSeen.push('identity'));
		onRepoReset(() => listSeen.push('cleanup'));

		resetForRepo();
		expect(listSeen).toEqual(['identity', 'cleanup']);
	});
});

describe('ownsGraph', () => {
	it('takes the graph down for the requests the graph is made of', () => {
		expect(ownsGraph('loadCommits')).toBe(true);
		expect(ownsGraph('selectRepo')).toBe(true);
		// `loadCommits` reports its own failures as `type: 'error'` carrying no `source` at all
		// (see `extension/src/app/useCases/loadCommits.ts`), and those are exactly the failures that
		// mean there is no graph — so an absent source has to keep the error screen.
		expect(ownsGraph(undefined)).toBe(true);
	});

	it('leaves the graph standing when a side query fails beside it', () => {
		expect(ownsGraph('copyText')).toBe(false);
		expect(ownsGraph('saveViewSettings')).toBe(false);
		expect(ownsGraph('openTerminal')).toBe(false);
	});
});
