import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Commit } from '@git-octopus/shared';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { cherryPickEditor } = await import('../../lib/stores/cherryPickEditor.svelte');
const { default: CherryPickEditor } = await import('./CherryPickEditor.svelte');

const commit = (hash: string, subject: string): Commit => ({
	hash: hash.repeat(40),
	parents: ['f'.repeat(40)],
	author: { name: 'Ada', email: 'ada@example.com' },
	committedAt: 1_700_000_000,
	authoredAt: 1_700_000_000,
	subject,
	refs: [],
});

async function openWith(): Promise<void> {
	render(CherryPickEditor);
	// The graph's selection is newest first.
	cherryPickEditor.open([commit('c', 'three'), commit('b', 'two'), commit('a', 'one')], 'main');
	await screen.findByText('one');
}

const row = (subject: string) => screen.getByText(subject).closest('li') as HTMLElement;

describe('CherryPickEditor', () => {
	it('lists the selection oldest first and names the branch it lands on', async () => {
		await openWith();
		const listSubjects = screen
			.getAllByRole('option')
			.map((li) => li.querySelector('.subject')?.textContent);
		expect(listSubjects).toEqual(['one', 'two', 'three']);
		expect(screen.getByText('main')).toBeTruthy();
		expect(screen.getByText('Cherry pick 3 commits')).toBeTruthy();
	});

	it('sends the commits kept, in the order shown, with the options', async () => {
		listSent.length = 0;
		await openWith();
		await fireEvent.keyDown(row('three'), { key: 'ArrowUp', altKey: true });
		await fireEvent.keyDown(row('two'), { key: ' ' });
		await fireEvent.click(screen.getByLabelText(/Record where each commit came from/));
		await fireEvent.click(screen.getByText('Cherry pick 2 commits'));
		expect(listSent.at(-1)).toEqual({
			type: 'cherryPickCommits',
			repoPath: '',
			listHashes: ['a'.repeat(40), 'c'.repeat(40)],
			recordOrigin: true,
			noCommit: false,
		});
		expect(cherryPickEditor.current).toBeNull();
	});

	it('cannot run with every commit left out', async () => {
		await openWith();
		for (const subject of ['one', 'two', 'three']) {
			await fireEvent.click(screen.getByLabelText(`Pick ${subject}`));
		}
		expect((screen.getByText('Cherry pick 0 commits') as HTMLButtonElement).disabled).toBe(true);
		cherryPickEditor.close();
	});
});
