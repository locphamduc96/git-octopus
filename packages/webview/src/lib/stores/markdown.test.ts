import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

async function load() {
	const listSent: { type: string; [key: string]: unknown }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: { type: string }) => listSent.push(message),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { markdownPanel } = await import('./markdown.svelte');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	const send = (message: HostToWebview) => dispatchHostMessage(message);
	return { markdownPanel, send, resetForRepo, listSent };
}

const EXPLAIN: HostToWebview = {
	type: 'showMarkdown',
	title: 'Merge branch feature/merged',
	content: '# Merge branch feature/merged\n\nBody\n',
};

describe('markdown panel', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('shows what the host sends, and goes away when closed', async () => {
		const { markdownPanel, send } = await load();
		expect(markdownPanel.shown).toBeNull();
		send(EXPLAIN);
		expect(markdownPanel.shown).toEqual({
			title: 'Merge branch feature/merged',
			content: '# Merge branch feature/merged\n\nBody\n',
		});
		markdownPanel.close();
		expect(markdownPanel.shown).toBeNull();
	});

	it('copies through the host’s clipboard', async () => {
		const { markdownPanel, send, listSent } = await load();
		send(EXPLAIN);
		markdownPanel.copy('the text');
		expect(listSent).toEqual([{ type: 'copyText', text: 'the text', label: 'explanation' }]);
	});

	it('asks the host to save, suggesting a file named after the title', async () => {
		const { markdownPanel, send, listSent } = await load();
		send(EXPLAIN);
		markdownPanel.save('the text');
		expect(listSent).toEqual([
			{
				type: 'saveMarkdown',
				content: 'the text',
				suggestedName: 'Merge branch feature/merged.md',
			},
		]);
	});

	it('keeps a long title from making a long file name', async () => {
		const { markdownPanel, send, listSent } = await load();
		send({ ...EXPLAIN, title: 'x'.repeat(200) });
		markdownPanel.save('t');
		expect((listSent[0].suggestedName as string).length).toBe(83);
	});

	it('hands a clicked link to the host to open', async () => {
		const { markdownPanel, listSent } = await load();
		markdownPanel.openLink('https://example.com/docs');
		expect(listSent).toEqual([{ type: 'openLink', url: 'https://example.com/docs' }]);
	});

	it('is closed when the view moves to another repository', async () => {
		const { markdownPanel, send, resetForRepo } = await load();
		send(EXPLAIN);
		resetForRepo();
		expect(markdownPanel.shown).toBeNull();
	});
});
