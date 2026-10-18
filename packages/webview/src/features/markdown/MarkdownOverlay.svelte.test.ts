import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { markdownPanel } = await import('../../lib/stores/markdown.svelte');
const { default: MarkdownOverlay } = await import('./MarkdownOverlay.svelte');

const CONTENT =
	'# Commit abc\n\nSee [the docs](https://example.com/docs) and [run](javascript:alert(1)).\n';

function show(): void {
	dispatchHostMessage({ type: 'showMarkdown', title: 'Commit abc', content: CONTENT });
}

describe('MarkdownOverlay', () => {
	afterEach(() => {
		markdownPanel.close();
		listSent.length = 0;
	});

	it('shows nothing until the host sends Markdown', () => {
		render(MarkdownOverlay);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows the Markdown in a panel over the view, titled as the host said', async () => {
		render(MarkdownOverlay);
		show();
		expect(await screen.findByRole('dialog', { name: 'Commit abc' })).toBeTruthy();
		expect(await screen.findByRole('heading', { level: 1, name: 'Commit abc' })).toBeTruthy();
	});

	it('copies through the host and saves through the host', async () => {
		render(MarkdownOverlay);
		show();
		(await screen.findByRole('button', { name: 'Copy' })).click();
		screen.getByRole('button', { name: 'Save as…' }).click();
		expect(listSent).toEqual([
			{ type: 'copyText', text: CONTENT, label: 'explanation' },
			{ type: 'saveMarkdown', content: CONTENT, suggestedName: 'Commit abc.md' },
		]);
	});

	it('opens an https link through the host and leaves a javascript: link inert', async () => {
		render(MarkdownOverlay);
		show();
		(await screen.findByRole('link', { name: 'the docs' })).click();
		expect(listSent).toEqual([{ type: 'openLink', url: 'https://example.com/docs' }]);
		expect(screen.queryByRole('link', { name: 'run' })).toBeNull();
	});

	it('closes with its close button and with Escape', async () => {
		render(MarkdownOverlay);
		show();
		(await screen.findByRole('button', { name: 'Close' })).click();
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

		show();
		await fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
