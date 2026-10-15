import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { default: RemotesSection } = await import('./RemotesSection.svelte');

describe('RemotesSection', () => {
	it('lists the remotes, with the push URL only where it differs', async () => {
		render(RemotesSection);
		dispatchHostMessage({
			type: 'remotes',
			listRemotes: [
				{ name: 'origin', fetchUrl: 'git@a:x.git' },
				{ name: 'mirror', fetchUrl: 'https://b/x.git', pushUrl: 'git@b:x.git' },
			],
		});
		expect(await screen.findByText('git@a:x.git')).toBeTruthy();
		expect(screen.getByText('push: git@b:x.git')).toBeTruthy();
	});

	it('adds a remote by name and URL, and removes one from its row', async () => {
		listSent.length = 0;
		render(RemotesSection);
		dispatchHostMessage({ type: 'remotes', listRemotes: [{ name: 'origin', fetchUrl: 'u' }] });
		await fireEvent.input(screen.getByLabelText('Remote name'), { target: { value: 'team' } });
		await fireEvent.input(screen.getByLabelText('Remote URL'), {
			target: { value: 'git@c:t.git' },
		});
		await fireEvent.click(screen.getByText('Add & fetch'));
		expect(listSent.at(-1)).toMatchObject({
			type: 'remoteAction',
			action: 'add',
			name: 'team',
			url: 'git@c:t.git',
		});
		dispatchHostMessage({ type: 'remotes', listRemotes: [{ name: 'origin', fetchUrl: 'u' }] });
		await fireEvent.click(
			(await screen.findAllByLabelText('Remove origin'))[0].closest('button') as HTMLElement
		);
		expect(listSent.at(-1)).toMatchObject({
			type: 'remoteAction',
			action: 'remove',
			name: 'origin',
		});
	});
});
