import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialRequest } from '@git-octopus/host/app/ports/credentialPrompt';
import { nativeCredentialPrompt } from './nativeCredentialPrompt.js';
import { openPrompts, recorded, resetRecorded, window } from '../../test/vscodeStub.js';

/**
 * The UI half of the bridge: whether a question actually leaves the screen when the git process
 * that asked it is gone. A prompt that outlives its asker collects an answer nobody can read, and
 * until it closes the next command's prompt is stuck behind it.
 */
const TITLE = 'Git Octopus: push — repo → example.invalid';

function makeRequest(kind: 'username' | 'secret' | 'confirm'): CredentialRequest {
	return {
		title: TITLE,
		prompt: kind === 'confirm' ? 'Continue connecting (yes/no)?' : 'Password:',
		secret: kind !== 'username',
	};
}

beforeEach(resetRecorded);

describe('nativeCredentialPrompt', () => {
	it('takes a confirmation down when its git process gives up', async () => {
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('confirm'), abort.signal);

		expect(openPrompts()).toHaveLength(1);
		expect(openPrompts()[0].kind).toBe('quickPick');

		abort.abort();
		await expect(answered).resolves.toBeUndefined();
		expect(openPrompts()).toHaveLength(0);
		expect(recorded.listPrompts[0].cancelled).toBe(true);
	});

	it('takes a credential prompt down the same way', async () => {
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('secret'), abort.signal);

		expect(openPrompts()[0].kind).toBe('inputBox');
		abort.abort();
		await expect(answered).resolves.toBeUndefined();
		expect(openPrompts()).toHaveLength(0);
	});

	it('leaves nothing in the way of the next authentication prompt', async () => {
		// The sequence the finding describes: a confirmation times out, then another command asks.
		const first = new AbortController();
		const stale = nativeCredentialPrompt.ask(makeRequest('confirm'), first.signal);
		first.abort();
		await stale;

		const second = new AbortController();
		const live = nativeCredentialPrompt.ask(makeRequest('secret'), second.signal);
		const listOpen = openPrompts();
		expect(listOpen).toHaveLength(1);
		expect(listOpen[0].kind).toBe('inputBox');

		listOpen[0].answer('hunter2');
		await expect(live).resolves.toBe('hunter2');
	});

	it('asks a confirmation with a cancellable picker, not a modal that only the user can close', async () => {
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('confirm'), abort.signal);
		// A modal would have gone through showWarningMessage, which no token can dismiss.
		expect(recorded.listInfo).toEqual([]);
		expect(recorded.listPrompts[0].title).toBe(TITLE);
		abort.abort();
		await answered;
	});

	it('answers yes and no as the protocol words', async () => {
		const abort = new AbortController();

		const refused = nativeCredentialPrompt.ask(makeRequest('confirm'), abort.signal);
		openPrompts()[0].answer({ value: 'no' });
		await expect(refused).resolves.toBe('no');

		const allowed = nativeCredentialPrompt.ask(makeRequest('confirm'), abort.signal);
		openPrompts()[0].answer({ value: 'yes' });
		await expect(allowed).resolves.toBe('yes');
	});

	it('reads a dismissed picker as a refusal', async () => {
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('confirm'), abort.signal);
		openPrompts()[0].answer(undefined);
		await expect(answered).resolves.toBeUndefined();
	});

	it('reads a dismissed input box as a refusal', async () => {
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('secret'), abort.signal);
		openPrompts()[0].answer(undefined);
		await expect(answered).resolves.toBeUndefined();
	});

	it('titles the input box from the host and shows the question as its prompt', async () => {
		const spy = vi.spyOn(window, 'showInputBox');
		const abort = new AbortController();
		const answered = nativeCredentialPrompt.ask(makeRequest('username'), abort.signal);
		expect(recorded.listPrompts[0].title).toBe(TITLE);
		expect(spy.mock.calls[0][0]).toMatchObject({ title: TITLE, prompt: 'Password:' });
		openPrompts()[0].answer('octo');
		await expect(answered).resolves.toBe('octo');
		spy.mockRestore();
	});

	it('masks the input box exactly when the request is secret', async () => {
		const spy = vi.spyOn(window, 'showInputBox');
		const abort = new AbortController();

		const username = nativeCredentialPrompt.ask(makeRequest('username'), abort.signal);
		openPrompts()[0].answer('octo');
		await username;
		const password = nativeCredentialPrompt.ask(makeRequest('secret'), abort.signal);
		openPrompts()[0].answer('hunter2');
		await password;

		expect(spy.mock.calls.map(([options]) => (options as { password: boolean }).password)).toEqual([
			false,
			true,
		]);
		spy.mockRestore();
	});
});
