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
	const { credentials } = await import('./credentials.svelte');
	const { dispatchHostMessage } = await import('../hostRouter');
	const send = (message: HostToWebview) => dispatchHostMessage(message);
	return { credentials, send, listSent };
}

const PASSWORD: HostToWebview = {
	type: 'credentialRequest',
	id: 4,
	title: 'Git Octopus: push — octo-repo → example.invalid',
	prompt: "Password for 'https://octo@example.invalid':",
	secret: true,
	confirm: false,
};

describe('credential questions', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('holds the question the host asked, as data', async () => {
		const { credentials, send } = await load();
		expect(credentials.current).toBeNull();
		send(PASSWORD);
		expect(credentials.current).toEqual({
			id: 4,
			title: 'Git Octopus: push — octo-repo → example.invalid',
			prompt: "Password for 'https://octo@example.invalid':",
			secret: true,
			confirm: false,
		});
	});

	it('sends the answer typed back to the desktop host, and closes the question', async () => {
		const { credentials, send, listSent } = await load();
		send(PASSWORD);
		credentials.answer(4, 'hunter2');
		expect(credentials.current).toBeNull();
		expect(listSent).toEqual([{ type: 'credentialReply', id: 4, answer: 'hunter2' }]);
	});

	it('sends no answer at all when the user cancels', async () => {
		const { credentials, send, listSent } = await load();
		send(PASSWORD);
		credentials.cancel(4);
		expect(credentials.current).toBeNull();
		expect(listSent).toEqual([{ type: 'credentialReply', id: 4 }]);
	});

	it('does not show a question twice when the host asks it again after a reload', async () => {
		const { credentials, send } = await load();
		send(PASSWORD);
		send(PASSWORD);
		credentials.cancel(4);
		expect(credentials.current).toBeNull();
	});

	it('takes the question down when the host withdraws it, and sends nothing back', async () => {
		const { credentials, send, listSent } = await load();
		send(PASSWORD);
		send({ type: 'credentialCancel', id: 4 });
		expect(credentials.current).toBeNull();
		expect(listSent).toEqual([]);
	});

	it('asks them in the order they came', async () => {
		const { credentials, send } = await load();
		send(PASSWORD);
		send({ ...PASSWORD, id: 5, prompt: "Username for 'https://example.invalid':", secret: false });
		expect(credentials.current?.id).toBe(4);
		credentials.answer(4, 'x');
		expect(credentials.current?.id).toBe(5);
	});
});
