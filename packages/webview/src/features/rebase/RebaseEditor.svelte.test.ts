import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { rebaseEditor } = await import('../../lib/stores/rebaseEditor.svelte');
const { default: RebaseEditor } = await import('./RebaseEditor.svelte');

const commit = (hash: string, subject: string) => ({
	hash: hash.repeat(40),
	subject,
	message: `${subject}\n\nbody`,
	author: 'Ada',
});

async function openWith(base: string) {
	render(RebaseEditor);
	rebaseEditor.open(base);
	dispatchHostMessage({
		type: 'rebaseTodo',
		base,
		listCommits: [commit('a', 'one'), commit('b', 'two'), commit('c', 'three')],
	});
	await screen.findByText('one');
}

const row = (subject: string) => screen.getByText(subject).closest('li') as HTMLElement;

describe('RebaseEditor', () => {
	it('asks the host for the commits after the base', async () => {
		listSent.length = 0;
		await openWith('base1');
		expect(listSent[0]).toEqual({ type: 'loadRebaseTodo', base: 'base1' });
	});

	it('refuses to squash the first commit kept, and says why', async () => {
		await openWith('base2');
		await fireEvent.keyDown(row('one'), { key: 's' });
		expect(screen.getByText(/first commit kept/)).toBeTruthy();
		expect((screen.getByText('Start rebase') as HTMLButtonElement).disabled).toBe(true);
	});

	it('sends the steps in the order shown, with the reworded message', async () => {
		listSent.length = 0;
		await openWith('base3');
		await fireEvent.keyDown(row('three'), { key: 'ArrowUp', altKey: true });
		await fireEvent.keyDown(row('one'), { key: 'd' });
		await fireEvent.keyDown(row('two'), { key: 'r' });
		const box = screen.getByLabelText('New message for two') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'two, better' } });
		await fireEvent.click(screen.getByText('Start rebase'));
		expect(listSent.at(-1)).toEqual({
			type: 'interactiveRebase',
			repoPath: '',
			base: 'base3',
			listSteps: [
				{ hash: 'a'.repeat(40), action: 'drop' },
				{ hash: 'c'.repeat(40), action: 'pick' },
				{ hash: 'b'.repeat(40), action: 'reword', message: 'two, better' },
			],
		});
	});

	it('shows why the commits cannot be rewritten, instead of a list', async () => {
		render(RebaseEditor);
		rebaseEditor.open('base4');
		dispatchHostMessage({
			type: 'rebaseTodo',
			base: 'base4',
			listCommits: [],
			error: 'HEAD is detached',
		});
		expect(await screen.findByText('HEAD is detached')).toBeTruthy();
	});
});
