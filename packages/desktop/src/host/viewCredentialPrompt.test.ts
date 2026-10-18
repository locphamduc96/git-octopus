import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';
import { ViewCredentialPrompt } from './viewCredentialPrompt.js';

const PASSWORD = {
	title: 'Git Octopus: push — octo-repo → example.invalid',
	prompt: "Password for 'https://octo@example.invalid':",
	secret: true,
};
const USERNAME = {
	title: 'Git Octopus: push — octo-repo → example.invalid',
	prompt: "Username for 'https://example.invalid':",
	secret: false,
};
const HOST_KEY = {
	title: 'Git Octopus: fetch — octo-repo → example.invalid',
	prompt:
		'The authenticity of host example.invalid cannot be established. Are you sure you want to continue connecting (yes/no/[fingerprint])?',
	secret: true,
};

function setup() {
	const listPosted: HostToWebview[] = [];
	const prompt = new ViewCredentialPrompt((message) => listPosted.push(message));
	const lastId = (): number =>
		(listPosted.filter((m) => m.type === 'credentialRequest').at(-1) as { id: number }).id;
	return { prompt, listPosted, lastId };
}

describe('ViewCredentialPrompt', () => {
	it('asks the view with the host title, git’s words and whether to mask the answer', async () => {
		const { prompt, listPosted, lastId } = setup();
		const answer = prompt.ask(PASSWORD, new AbortController().signal);
		expect(listPosted).toEqual([
			{
				type: 'credentialRequest',
				id: lastId(),
				title: PASSWORD.title,
				prompt: PASSWORD.prompt,
				secret: true,
				confirm: false,
			},
		]);
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: 'hunter2' });
		await expect(answer).resolves.toBe('hunter2');
		expect(prompt.openCount).toBe(0);
	});

	it('hands a username question over unmasked', () => {
		const { prompt, listPosted } = setup();
		void prompt.ask(USERNAME, new AbortController().signal);
		expect(listPosted[0]).toMatchObject({ secret: false, confirm: false });
	});

	it('hands git nothing when the user cancels', async () => {
		const { prompt, lastId } = setup();
		const answer = prompt.ask(PASSWORD, new AbortController().signal);
		prompt.receiveReply({ type: 'credentialReply', id: lastId() });
		await expect(answer).resolves.toBeUndefined();
	});

	it('keeps an empty answer, which is a real answer', async () => {
		const { prompt, lastId } = setup();
		const answer = prompt.ask(PASSWORD, new AbortController().signal);
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: '' });
		await expect(answer).resolves.toBe('');
	});

	it('turns the SSH host-key question into buttons, and accepts only yes or no for it', async () => {
		const { prompt, listPosted, lastId } = setup();
		const yes = prompt.ask(HOST_KEY, new AbortController().signal);
		expect(listPosted[0]).toMatchObject({ confirm: true, secret: true });
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: 'yes' });
		await expect(yes).resolves.toBe('yes');

		const no = prompt.ask(HOST_KEY, new AbortController().signal);
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: 'no' });
		await expect(no).resolves.toBe('no');

		const typed = prompt.ask(HOST_KEY, new AbortController().signal);
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: 'maybe' });
		await expect(typed).resolves.toBeUndefined();
	});

	it('withdraws the question from the view once the asking git process is gone', async () => {
		const { prompt, listPosted, lastId } = setup();
		const controller = new AbortController();
		const answer = prompt.ask(PASSWORD, controller.signal);
		const id = lastId();
		controller.abort();
		await expect(answer).resolves.toBeUndefined();
		expect(listPosted.at(-1)).toEqual({ type: 'credentialCancel', id });
		prompt.receiveReply({ type: 'credentialReply', id, answer: 'late' });
		expect(prompt.openCount).toBe(0);
	});

	it('does not ask at all for a process that is already gone', async () => {
		const { prompt, listPosted } = setup();
		const controller = new AbortController();
		controller.abort();
		await expect(prompt.ask(PASSWORD, controller.signal)).resolves.toBeUndefined();
		expect(listPosted).toEqual([]);
	});

	it('ignores a reply for a question that is not open', () => {
		const { prompt } = setup();
		expect(() =>
			prompt.receiveReply({ type: 'credentialReply', id: 99, answer: 'x' })
		).not.toThrow();
	});

	it('puts the open questions to a view that attached late', () => {
		const { prompt, listPosted } = setup();
		void prompt.ask(PASSWORD, new AbortController().signal);
		prompt.resend();
		expect(listPosted.map((m) => m.type)).toEqual(['credentialRequest', 'credentialRequest']);
		expect(listPosted[1]).toEqual(listPosted[0]);
	});

	it('refuses every open question when asked to cancel them all', async () => {
		const { prompt, listPosted } = setup();
		const first = prompt.ask(PASSWORD, new AbortController().signal);
		const second = prompt.ask(USERNAME, new AbortController().signal);
		prompt.cancelAll();
		await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
		expect(listPosted.filter((m) => m.type === 'credentialCancel')).toHaveLength(2);
	});

	it('never writes an answer into what it posts', async () => {
		const { prompt, listPosted, lastId } = setup();
		const answer = prompt.ask(PASSWORD, new AbortController().signal);
		prompt.receiveReply({ type: 'credentialReply', id: lastId(), answer: 'S3cr3t-pass' });
		await answer;
		expect(JSON.stringify(listPosted)).not.toContain('S3cr3t-pass');
	});
});
